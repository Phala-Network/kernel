import { commConfigurations, COMMS } from 'config'
import { lastPlayerParcel } from 'shared/world/positionThings'
import { notifyStatusThroughChat } from './chat'
import { CliBrokerConnection } from './v1/CliBrokerConnection'
import { IBrokerTransport } from './v1/IBrokerTransport'
import { getCurrentPeer, localProfileUUID, receiveUserData } from './peers'
import { UserInformation, ConnectionEstablishmentError, UnknownCommsModeError } from './interface/types'
import { BrokerWorldInstanceConnection } from '../comms/v1/brokerWorldInstanceConnection'
import { ensureRendererEnabled } from '../world/worldState'
import { WorldInstanceConnection } from './interface/index'
import { LighthouseConnectionConfig, LighthouseWorldInstanceConnection } from './v2/LighthouseWorldInstanceConnection'
import { Authenticator, AuthIdentity } from 'dcl-crypto'
import { getCommsServer, getRealm, getAllCatalystCandidates } from '../dao/selectors'
import { Store } from 'redux'
import { store } from 'shared/store/isolatedStore'
import { setCatalystRealmCommsStatus, setCatalystRealm, markCatalystRealmConnectionError } from 'shared/dao/actions'
import { pickCatalystRealm } from 'shared/dao'
import { realmToString } from '../dao/utils/realmToString'
import { getCommsConfig } from 'shared/meta/selectors'
import { ensureMetaConfigurationInitialized } from 'shared/meta/index'
import {
  BringDownClientAndShowError,
  ErrorContext,
  ReportFatalErrorWithCommsPayload
} from 'shared/loading/ReportFatalError'
import { NEW_LOGIN, COMMS_COULD_NOT_BE_ESTABLISHED, commsEstablished } from 'shared/loading/types'
import { getIdentity, getStoredSession } from 'shared/session'
import { setCommsIsland } from './actions'
import { getCommsIsland, getPreferedIsland } from './selectors'
import { RootCommsState } from './types'
import { MinPeerData, Position3D } from '@dcl/catalyst-peer'
import { commsLogger, CommsContext } from './context'
import { bindHandlersToCommsContext } from './handlers'
import { initVoiceCommunicator } from './voice-over-comms'
import { getCurrentIdentity } from 'shared/session/selectors'
import { getCommsContext } from 'shared/protocol/selectors'
import { setWorldContext } from 'shared/protocol/actions'
import { Realm } from 'shared/dao/types'

export type CommsVersion = 'v1' | 'v2' | 'v3'
export type CommsMode = CommsV1Mode | CommsV2Mode
export type CommsV1Mode = 'local' | 'remote'
export type CommsV2Mode = 'p2p' | 'server'

export function sendPublicChatMessage(messageId: string, text: string) {
  const commsContext = getCommsContext(store.getState())

  if (commsContext && commsContext.currentPosition && commsContext.worldInstanceConnection) {
    commsContext.worldInstanceConnection
      .sendChatMessage(commsContext.currentPosition, messageId, text)
      .catch((e) => commsLogger.warn(`error while sending message `, e))
  }
}

export function sendParcelSceneCommsMessage(cid: string, message: string) {
  const commsContext = getCommsContext(store.getState())

  if (commsContext && commsContext.currentPosition && commsContext.worldInstanceConnection) {
    commsContext.worldInstanceConnection
      .sendParcelSceneCommsMessage(cid, message)
      .catch((e) => commsLogger.warn(`error while sending message `, e))
  }
}

export function updateCommsUser(changes: Partial<UserInformation>) {
  const peer = getCurrentPeer()

  if (!peer || !localProfileUUID) throw new Error('cannotGetCurrentPeer')
  if (!peer.user) throw new Error('cannotGetCurrentPeer.user')

  Object.assign(peer.user, changes)

  receiveUserData(localProfileUUID, peer.user)

  const user = peer.user

  if (user) {
    const commsContext = getCommsContext(store.getState())

    if (commsContext) {
      commsContext.userInfo = user
    }
  }
}

function parseCommsMode(modeString: string) {
  const segments = modeString.split('-')
  return segments as [CommsVersion, CommsMode]
}

export async function connect(realm: Realm): Promise<void> {
  const realmString = realmToString(realm)
  const q = new URLSearchParams(window.location.search)
  q.set('realm', realmString)
  history.replaceState({ realm: realmString }, '', `?${q.toString()}`)

  commsLogger.log('Connecting to realm', realm)
  try {
    const identity = getCurrentIdentity(store.getState())

    if (!identity) {
      return
    }

    const user = await getStoredSession(identity.address)

    if (!user) {
      return
    }

    const userInfo = {
      userId: identity.address,
      ...user
    }

    const commsContext = new CommsContext(userInfo)

    initVoiceCommunicator(user.identity.address)

    let connection: WorldInstanceConnection

    const DEFAULT_PROTOCOL = 'v2-p2p'
    const protocol = realm?.protocol ?? DEFAULT_PROTOCOL
    const [version, mode] = parseCommsMode(protocol)

    switch (version) {
      case 'v1': {
        let commsBroker: IBrokerTransport

        switch (mode) {
          case 'local': {
            let location = document.location.toString()
            if (location.indexOf('#') > -1) {
              location = location.substring(0, location.indexOf('#')) // drop fragment identifier
            }
            const commsUrl = location.replace(/^http/, 'ws') // change protocol to ws

            const url = new URL(commsUrl)
            const qs = new URLSearchParams({
              identity: btoa(user.identity.address)
            })
            url.search = qs.toString()

            commsLogger.log('Using WebSocket comms: ' + url.href)
            commsBroker = new CliBrokerConnection(url.href)
            break
          }
          // 1 case 'remote': {
          // 1  const qs = new URLSearchParams(document.location.search)
          // 1  const nats = qs.get('nats') || 'wss://nats.decentraland.io'
          // 1  commsBroker = new NatsBrokerConnection(nats)
          // 1  break
          // 1 }
          default: {
            throw new UnknownCommsModeError(`unrecognized mode for comms v1 "${mode}"`)
          }
        }

        connection = new BrokerWorldInstanceConnection(commsBroker)
        break
      }
      case 'v2': {
        await ensureMetaConfigurationInitialized()
        const lighthouseUrl = getCommsServer(store.getState())
        const commsConfig = getCommsConfig(store.getState())

        const peerConfig: LighthouseConnectionConfig = {
          connectionConfig: {
            iceServers: commConfigurations.defaultIceServers
          },
          authHandler: async (msg: string) => {
            try {
              return Authenticator.signPayload(getIdentity() as AuthIdentity, msg)
            } catch (e) {
              commsLogger.info(`error while trying to sign message from lighthouse '${msg}'`)
            }
            // if any error occurs
            return getIdentity()
          },
          logLevel: 'NONE',
          targetConnections: commsConfig.targetConnections ?? 4,
          maxConnections: commsConfig.maxConnections ?? 6,
          positionConfig: {
            selfPosition: () => {
              if (commsContext.currentPosition) {
                return commsContext.currentPosition.slice(0, 3) as Position3D
              }
            },
            maxConnectionDistance: 4,
            nearbyPeersDistance: 5,
            disconnectDistance: 5
          },
          eventsHandler: {
            onIslandChange: (island: string | undefined, peers: MinPeerData[]) => {
              store.dispatch(setCommsIsland(island))
              commsContext.removeMissingPeers(peers)
            },
            onPeerLeftIsland: (peerId: string) => {
              commsContext.removePeer(peerId)
            }
          },
          preferedIslandId: getPreferedIsland(store.getState())
        }

        if (!commsConfig.relaySuspensionDisabled) {
          peerConfig.relaySuspensionConfig = {
            relaySuspensionInterval: commsConfig.relaySuspensionInterval ?? 750,
            relaySuspensionDuration: commsConfig.relaySuspensionDuration ?? 5000
          }
        }

        commsLogger.log('Using Remote lighthouse service: ', lighthouseUrl)

        connection = new LighthouseWorldInstanceConnection(lighthouseUrl, peerConfig, (status) => {
          store.dispatch(setCatalystRealmCommsStatus(status))
          switch (status.status) {
            case 'realm-full': {
              handleFullLayer()
              break
            }
            case 'reconnection-error': {
              handleReconnectionError()
              break
            }
            case 'id-taken': {
              handleIdTaken()
              break
            }
          }
        })

        break
      }
      case 'v3': {
        const commsUrl = mode == 'local' ? 'ws://0.0.0.0:5000/ws' : 'wss://explorer-bff.decentraland.io/ws'

        const url = new URL(commsUrl)
        const qs = new URLSearchParams({
          identity: btoa(user.identity.address)
        })
        url.search = qs.toString()

        commsLogger.log('Using WebSocket comms: ' + url.href)
        const commsBroker = new CliBrokerConnection(url.href)

        connection = new BrokerWorldInstanceConnection(commsBroker)

        break
      }
      default: {
        throw new Error(`unrecognized comms mode "${COMMS}"`)
      }
    }

    store.dispatch(setWorldContext(commsContext))
    await ensureRendererEnabled()
    await commsContext.connect(connection)
    await bindHandlersToCommsContext(commsContext)

    store.dispatch(commsEstablished())
  } catch (e: any) {
    commsLogger.error(`Error while trying to establish communications`)
    commsLogger.error(e)

    ReportFatalErrorWithCommsPayload(e, ErrorContext.COMMS_INIT)
    BringDownClientAndShowError(COMMS_COULD_NOT_BE_ESTABLISHED)

    store.dispatch(setWorldContext(undefined))

    throw new ConnectionEstablishmentError(e.message)
  }
}

function handleReconnectionError() {
  const realm = getRealm(store.getState())

  if (realm) {
    store.dispatch(markCatalystRealmConnectionError(realm))
  }

  const candidates = getAllCatalystCandidates(store.getState())

  const otherRealm = pickCatalystRealm(candidates, [lastPlayerParcel.x, lastPlayerParcel.y])

  const notificationMessage = realm
    ? `Lost connection to ${realmToString(realm)}, joining realm ${realmToString(otherRealm)} instead`
    : `Joining realm ${realmToString(otherRealm)}`

  notifyStatusThroughChat(notificationMessage)

  store.dispatch(setCatalystRealm(otherRealm))
}

function handleIdTaken() {
  store.dispatch(setWorldContext(undefined))
  ReportFatalErrorWithCommsPayload(new Error(`Handle Id already taken`), ErrorContext.COMMS_INIT)
  BringDownClientAndShowError(NEW_LOGIN)
}

function handleFullLayer() {
  // const realm = getRealm(store.getState())

  // if (realm) {
  //   store.dispatch(markCatalystRealmFull(realm))
  // }

  const candidates = getAllCatalystCandidates(store.getState())

  const otherRealm = pickCatalystRealm(candidates, [lastPlayerParcel.x, lastPlayerParcel.y])

  notifyStatusThroughChat(`Joining realm ${otherRealm.serverName} since the previously requested was full`)

  store.dispatch(setCatalystRealm(otherRealm))
}

function observeIslandChange(
  store: Store<RootCommsState>,
  onIslandChange: (previousIsland: string | undefined, currentIsland: string | undefined) => any
) {
  let currentIsland = getCommsIsland(store.getState())

  store.subscribe(() => {
    const previousIsland = currentIsland
    currentIsland = getCommsIsland(store.getState())
    if (currentIsland !== previousIsland) {
      onIslandChange(previousIsland, currentIsland)
    }
  })
}

export function initializeUrlIslandObserver() {
  observeIslandChange(store, (_previousIsland, currentIsland) => {
    const q = new URLSearchParams(location.search)

    if (currentIsland) {
      q.set('island', currentIsland)
    } else {
      q.delete('island')
    }

    history.replaceState({ island: currentIsland }, '', `?${q.toString()}`)
  })
}
