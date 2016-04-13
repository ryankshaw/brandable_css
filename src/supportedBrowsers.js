import _ from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import CONFIG from './config'

export default _.map(yaml.safeLoad(fs.readFileSync(CONFIG.paths.browsers_yml)).minimums, (version, browserName) => {
  return browserName.replace('Internet Explorer', 'Explorer') + ' >= ' + version
})
