const debug = require('debug')('brandable_css:cache')
import _ from 'lodash'
import {paths as PATHS} from './config'
import SASS_STYLE from './sass_style'
import {readJsonSync, outputJsonAsync} from 'fs-extra-promise'

const caches = ['file_checksums', 'bundles_with_deps']

let cache = {
  saveAll: async function () {
    await* caches.map(cacheName => cache[cacheName].save())
  }
}

function initCache (name) {
  const filename = PATHS[name] + SASS_STYLE
  let self = {
    isSaved: false,

    data: readJsonSync(filename, {throws: false}) || {},

    update (key, value) {
      if (_.isFunction(key)) throw new Error('cant use function as key' + key + value)
      if (self.data[key] === value) return value
      debug('updating cache key', key)
      self.isSaved = false
      self.data[key] = value
      return value
    },

    save () {
      debug('saving', self.isSaved, filename)
      if (self.isSaved) return
      self.isSaved = true
      return outputJsonAsync(filename, self.data, {spaces: 2})
    },

    clearMatching (query) {
      self.data = _.omit(self.data, (v, key) => key.match(query))
    }
  }
  cache[name] = self
}
caches.forEach(initCache)

export default cache
