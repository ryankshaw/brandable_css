const debug = require('debug')('brandable_css:cache')
import _ from 'lodash'
import {cdnObjectName} from './utils'
import {paths as PATHS} from './config'
import s3Bucket from './s3Bucket'
import SASS_STYLE from './sass_style'
import {readJsonAsync, outputJsonAsync} from 'fs-extra-promise'

const caches = ['file_checksums', 'bundles_with_deps']

let cache = {
  saveAll: async function () {
    await* caches.map(cacheName => cache[cacheName].save())
  },

  init: async function () {
    await* caches.map(initCache)
  }
}

async function initCache (name) {
  const filename = PATHS[name] + SASS_STYLE
  let self = {
    isSaved: false,

    update (key, value) {
      if (_.isFunction(key)) throw new Error('cant use function as key' + key + value)
      if (self.data[key] === value) return value
      debug('updating cache key', key)
      self.isSaved = false
      self.data[key] = value
      return value
    },

    read: async function() {
      let data
      try {
        if (s3Bucket) {
          debug('reading from s3', filename)
          data = JSON.parse(await s3Bucket.getObject({Key: cdnObjectName(filename)}))
        } else {
          debug('reading from fs', filename)
          data = await readJsonAsync(filename)
        }
      } catch (e) {
        debug(`couldnt read ${filename}, using empty cache`)
        data = {}
      }
      self.isSaved = false
      self.data = data
    },

    save () {
      debug('saving', self.isSaved, filename)
      if (self.isSaved) return
      self.isSaved = true
      if (s3Bucket) {
        return s3Bucket.uploadAsync({
          Key: cdnObjectName(filename),
          Body: JSON.stringify(self.data, null, 2)
        })
      } else {
        return outputJsonAsync(filename, self.data, {spaces: 2})
      }
    },

    clearMatching (query) {
      self.data = _.omit(self.data, (v, key) => key.match(query))
    }
  }
  await self.read()
  cache[name] = self
}

export default cache
