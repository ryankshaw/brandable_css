import _ from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import { paths } from './config'

export default _.map(yaml.safeLoad(fs.readFileSync(paths.browsers_yml)).minimums, (version, browserName) => {
  return browserName.replace('Internet Explorer', 'Explorer') + ' >= ' + version
})
