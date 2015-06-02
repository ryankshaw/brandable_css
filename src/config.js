import fs from 'fs'
import yaml from 'js-yaml'

export default Object.freeze(yaml.safeLoad(fs.readFileSync('config/brandable_css.yml')))