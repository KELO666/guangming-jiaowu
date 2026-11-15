import { createLocalApi } from './local'
import { createCloudApi } from './cloud'

export { testCloudConnection, checkSchema } from './cloud'

let current = null

export function getApi() {
  if (!current) throw new Error('数据层尚未初始化')
  return current
}

export function initApi(mode, cloudConf) {
  current = mode === 'cloud' ? createCloudApi(cloudConf) : createLocalApi()
  return current
}

export function getMode() {
  return current?.mode || null
}
