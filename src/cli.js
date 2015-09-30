import program from 'commander'
import { checkAll, startWatcher } from './main'
import { onError } from './utils'
import { init } from './cache'

program
  .version(require('../package').version)
  .option('--watch', 'watch for changes')
  .option('--brand-id [md5]', 'compile just the styles for a specific Brand Config')

program.parse(process.argv)

init().then(() => {
  checkAll({brandId: program.brandId}).catch(onError)
  if (program.watch) startWatcher()
}).catch(onError)
