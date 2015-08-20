import AWS from 'aws-sdk'
import { promisify } from 'bluebird'
import { memoize } from 'lodash'
import retry from 'bluebird-retry'
import loadConfig from './loadConfig'
import {debug} from './utils'
import handleGzip from './handleGzip'

const CDN_CONFIG = (loadConfig('config/canvas_cdn.yml') || {})[process.env.RAILS_ENV || 'development']

let s3Bucket
if (CDN_CONFIG.bucket) {
  AWS.config.update({
    logger: {log: debug}, // uncomment to enable http wire logging
    accessKeyId: CDN_CONFIG.aws_access_key_id,
    secretAccessKey: CDN_CONFIG.aws_secret_access_key
    // region: 'us-west-1' //do I need this?
  })

  s3Bucket = new AWS.S3({params: {Bucket: CDN_CONFIG.bucket}})

  s3Bucket.objectExists = memoize(function (Key) {
    return new Promise((resolve) => {
      this.headObject({Key}, (err, data) => {
        debug('headObject', Key, err, data)
        resolve(err ? false : data)
      })
    })
  })

  s3Bucket.uploadCSS = async function (Key, css) {
    const params = await handleGzip({
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

export default s3Bucket
