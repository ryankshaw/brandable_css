const debug = require('debug')('canvas_css')
import _ from 'lodash'
import {readJsonSync, outputJson} from './utils'
import PATHS from './paths'

const caches = ['file_checksums', 'bundles_with_deps']

let cache = {
  saveAll(){
    return caches.map(cacheName => this[cacheName].save())
  }
}

function initCache(name) {
  const filename = PATHS['sass_' + name]
  let self = {
    data: readJsonSync(filename),
    isSaved: false,
    update(key, value) {
      if (self.data[key] == value) return
      debug('updating cache key', key, value)
      self.isSaved = false
      self.data[key] = value
    },
    save(data) {
      debug('saving', self.isSaved, filename)
      if (self.isSaved) return
      self.isSaved = true
      return outputJson(filename, self.data)
    }
  }
  cache[name] = self
}
caches.forEach(initCache)

export default cache