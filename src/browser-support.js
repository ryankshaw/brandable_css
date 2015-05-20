import _ from 'lodash'
import yaml from 'js-yaml'
import fs from 'fs'
import {browsers_yml} from './paths'

export default _.map(yaml.safeLoad(fs.readFileSync(browsers_yml)).minimums, (version, browserName) => {
  return browserName.replace('Internet Explorer', 'Explorer') + ' >= ' + version
})