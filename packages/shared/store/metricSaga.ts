import { takeEvery } from 'redux-saga/effects'
import { trackEvent } from '../analytics'
import { SAVE_PROFILE_SUCCESS, SaveProfileSuccess } from '../profiles/actions'
import {
  NETWORK_MISMATCH,
  COMMS_ESTABLISHED,
  ESTABLISHING_COMMS,
  ExecutionLifecycleEvent,
  ExecutionLifecycleEventsList,
  NOT_STARTED,
  WAITING_FOR_RENDERER,
  METRICS_UNITY_CLIENT_LOADED,
  EXPERIENCE_STARTED,
  TELEPORT_TRIGGERED,
  SCENE_ENTERED,
  UNEXPECTED_ERROR_LOADING_CATALOG,
  UNEXPECTED_ERROR,
  METRICS_AUTH_SUCCESSFUL,
  NO_WEBGL_COULD_BE_CREATED,
  AUTH_ERROR_LOGGED_OUT,
  FAILED_FETCHING_UNITY,
  COMMS_ERROR_RETRYING,
  COMMS_COULD_NOT_BE_ESTABLISHED,
  MOBILE_NOT_SUPPORTED,
  NOT_INVITED,
  NEW_LOGIN,
  CATALYST_COULD_NOT_LOAD,
  AWAITING_USER_SIGNATURE,
  AVATAR_LOADING_ERROR
} from '../loading/types'
import { PARCEL_LOADING_STARTED } from 'shared/renderer/types'
import { INIT_SESSION } from 'shared/session/actions'

const trackingEvents: Record<ExecutionLifecycleEvent, string> = {
  // lifecycle events
  [NOT_STARTED]: 'session_start',
  [INIT_SESSION]: 'loading_1_start',
  [AWAITING_USER_SIGNATURE]: 'loading_1_1_awaiting_user_signature',
  [METRICS_AUTH_SUCCESSFUL]: 'loading_2_authOK',
  [ESTABLISHING_COMMS]: 'loading_3_init_comms',
  [COMMS_ESTABLISHED]: 'loading_4_comms_established',
  [WAITING_FOR_RENDERER]: 'loading_5_wait_renderer',
  [METRICS_UNITY_CLIENT_LOADED]: 'loading_6_unity_ok',
  [PARCEL_LOADING_STARTED]: 'loading_7_load_scenes',
  [EXPERIENCE_STARTED]: 'loading_8_finished',
  [TELEPORT_TRIGGERED]: 'teleport_triggered',
  [SCENE_ENTERED]: 'scene_entered',
  [NEW_LOGIN]: 'new_login',
  // errors
  [NETWORK_MISMATCH]: 'network_mismatch',
  [UNEXPECTED_ERROR]: 'error_fatal',
  [UNEXPECTED_ERROR_LOADING_CATALOG]: 'error_catalog',
  [NO_WEBGL_COULD_BE_CREATED]: 'error_webgl',
  [AUTH_ERROR_LOGGED_OUT]: 'error_authfail',
  [FAILED_FETCHING_UNITY]: 'error_fetchengine',
  [COMMS_ERROR_RETRYING]: 'error_comms_retry',
  [COMMS_COULD_NOT_BE_ESTABLISHED]: 'error_comms_failed',
  [CATALYST_COULD_NOT_LOAD]: 'error_catalyst_loading',
  [MOBILE_NOT_SUPPORTED]: 'unsupported_mobile',
  [NOT_INVITED]: 'error_not_invited',
  [AVATAR_LOADING_ERROR]: 'error_avatar_loading'
}

export function* metricSaga() {
  for (const event of ExecutionLifecycleEventsList) {
    yield takeEvery(event, (action) => {
      const _action: any = action
      trackEvent('lifecycle event', toTrackingEvent(event, _action.payload))
    })
  }
  yield takeEvery(SAVE_PROFILE_SUCCESS, (action: SaveProfileSuccess) =>
    trackEvent('avatar_edit_success', toAvatarEditSuccess(action.payload))
  )
}

function toTrackingEvent(event: ExecutionLifecycleEvent, payload: any) {
  const result = trackingEvents[event]

  if (event === COMMS_ERROR_RETRYING) {
    return { stage: result, retries: payload }
  }

  return { stage: result }
}

function toAvatarEditSuccess({ userId, version, profile }: SaveProfileSuccess['payload']) {
  return { userId, version, wearables: profile.avatar.wearables }
}
