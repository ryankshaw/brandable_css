const debug = require('debug')('canvas_css')
import _ from 'lodash'
import {readJsonSync} from './utils'
import {paths as PATHS} from "./config"
const outputJson = require('bluebird').promisify(require('fs-extra').outputJson)

const caches = ['file_checksums', 'bundles_with_deps']

let cache = {
  saveAll(){
    return caches.map(cacheName => cache[cacheName].save())
  }
}

function initCache(name) {
  const filename = PATHS[name]
  let self = {
    data: readJsonSync(filename),
    isSaved: false,

    update(key, value) {
      if (_.isFunction(key)) throw new Error('cant use function as key' + key + value)
      if (self.data[key] === value) return value
      debug('updating cache key', key, value)
      self.isSaved = false
      return self.data[key] = value
    },

    save() {
      debug('saving', self.isSaved, filename)
      if (self.isSaved) return
      self.isSaved = true
      return outputJson(filename, self.data)
    },

    clearMatching(query) {
      self.data = _.omit(self.data, (v, key) => key.match(query))
    }
  }
  cache[name] = self
}
caches.forEach(initCache)

export default cache