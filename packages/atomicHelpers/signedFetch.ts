import { AuthChain, Authenticator, AuthIdentity } from "dcl-crypto"
import { flatFetch, FlatFetchInit } from "./flatFetch"

export type SignedFetchInit = FlatFetchInit & {
  /** Overrides path in signature. To use when the requested service is behind a reverse proxy or something similar,
   *  and the exposed path doesn't correspond with the server's internal path for the request */
  pathToSignOverride?: string
}

const AUTH_CHAIN_HEADER_PREFIX = 'x-identity-auth-chain-'
const AUTH_TIMESTAMP_HEADER = 'x-identity-timestamp'
const AUTH_METADATA_HEADER = 'x-identity-metadata'

function getAuthHeaders(
  method: string,
  path: string,
  metadata: Record<string, any>,
  chainProvider: (payload: string) => AuthChain
) {
  const headers: Record<string, string> = {}
  const timestamp = Date.now()
  const metadataJSON = JSON.stringify(metadata)
  const payloadParts = [method.toLowerCase(), path.toLowerCase(), timestamp.toString(), metadataJSON]
  const payloadToSign = payloadParts.join(':').toLowerCase()

  const chain = chainProvider(payloadToSign)

  chain.forEach((link, index) => {
    headers[`${AUTH_CHAIN_HEADER_PREFIX}${index}`] = JSON.stringify(link)
  })

  headers[AUTH_TIMESTAMP_HEADER] = timestamp.toString()
  headers[AUTH_METADATA_HEADER] = metadataJSON

  return headers
}

export function signedFetch(url: string, identity: AuthIdentity, init?: SignedFetchInit, additionalMetadata: Record<string, any> = {}) {
  const path = init?.pathToSignOverride ?? new URL(url).pathname

  const actualInit = {
    ...init,
    headers: {
      ...getAuthHeaders(
        init?.method ?? 'get',
        path,
        {
          origin: location.origin,
          ...additionalMetadata
        },
        (payload) => Authenticator.signPayload(identity, payload)
      ),
      ...init?.headers
    }
  } as FlatFetchInit

  return flatFetch(url, actualInit)
}
