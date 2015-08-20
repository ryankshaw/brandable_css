import fs from 'fs'
import yaml from 'js-yaml'

export default function loadConfig (pathToYamlFile) {
  return Object.freeze(yaml.safeLoad(fs.readFileSync(pathToYamlFile)))
}
