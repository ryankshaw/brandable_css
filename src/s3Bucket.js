import AWS from 'aws-sdk'
import { promisify } from 'bluebird'
import { memoize } from 'lodash'
import retry from 'bluebird-retry'
import loadConfig from './loadConfig'
import {debug} from './utils'
const gzip = promisify(require('node-zopfli').gzip)

const customMethods = {
  objectExists: memoize(async function (Key) {
    return new Promise((resolve) => {
      this.headObject({Key}, (err, data) => {
        resolve(err ? false : data)
      })
    })
  }),

  handleGzip: async function (params) {
    const css = params.Body
    if (css.length > 150) { // gzipping small files is not worth it
      const gzipped = await gzip(new Buffer(css))
      const compression = Math.round(100 - (100.0 * gzipped.length / css.length))

      // If we couldn't compress more than 5%, the gzip decoding cost to the
      // client makes it is not worth serving gzipped
      if (compression > 5) {
        debug(`uploading gzipped ${params.Key} was: ${css.length} now: ${gzipped.length} saved: ${compression}%`)
        params.ContentEncoding = 'gzip'
        params.Body = gzipped
        return params
      }
    }
    debug(`uploading ungzipped ${params.Key}`)
    return params
  },

  uploadCSS: async function (Key, css) {
    const params = await this.handleGzip({
      Key,
      ACL: 'public-read',
      Body: css,
      CacheControl: 'public, max-age=31557600',
      ContentType: 'text/css'
    })
    const data = await retry(promisify(this.upload.bind(this, params)))
    debug('UploadedCSS', Key, data)
    return data
  }
}

const CDN_CONFIG = (loadConfig('config/canvas_cdn.yml') || {})[process.env.RAILS_ENV || 'development']
let s3Bucket
if (CDN_CONFIG.bucket) {
  AWS.config.update({
    logger: {log: debug},
    accessKeyId: CDN_CONFIG.aws_access_key_id,
    secretAccessKey: CDN_CONFIG.aws_secret_access_key
  })
  s3Bucket = new AWS.S3({params: {Bucket: CDN_CONFIG.bucket}})
  Object.assign(s3Bucket, customMethods)
}

export default s3Bucket
