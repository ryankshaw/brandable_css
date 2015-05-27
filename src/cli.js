import program from 'commander'
import main from './main'
import compileSingleBundle from './compile-bundle'

program
  .option('--watch', 'watch for changes')
  .option('--optional')
  .option('--bundle <bundle>', 'compile a specific bundle')
  .option('--variant <variant>', 'the variant (legacy_high_contrast, new_styles_normal_contrast, etc) you want')
  .option('--brand-variables-folder <brandVarablesFolder>', 'filesystem path to the folder that contains the _brand_variables.scss you want to use')

program.parse(process.argv)

// if they secified the specific bundle they want, (eg: from the brand_css rails controller),
// compile that one bundle and send it to stdout
if (program.bundle) {
  compileSingleBundle({
    bundleName: program.bundle,
    variant: program.variant,
    brandVariablesFolder: program.brandVariablesFolder
  })
    .then(function(res){ console.log(res.css) })
    .catch(main.onError)
} else {
  main.checkAll().catch(main.onError)
  if (program.watch) {
    main.watch()
  }
}




