# brandable_css

A tool for compiling SASS source files into different _variants_ that have
different values for their variables. This can be used, for example, to
provide a high-contrast mode for your styles.

## Configuration

```yaml
---
paths:
    # path to where static assets referenced in stylesheets through url() should
    # be resolved from, like images or fonts
    public_dir: public

    # the base directory for all your source SASS stylesheets:
    # 
    # - included in sass's "includePaths" so you can include relative to it
    # - must contain a "variants/${variant}" folder for each defined variant
    #   wherein that variant can define a "_variant_variables.scss" stylseheet
    #   to be used when compiling that specific variant
    # - used as the root when it's necessary to produce relative sass paths
    # - used as a target directory in the watch mode; changes to files inside
    #   will trigger the watcher
    #
    sass_dir: app/stylesheets

    # minimatch/glob pattern to select all the stylesheets to process; note
    # that this should not cover the partials, only the bundles that you want
    # to generate variants for
    # 
    # this is relative to PWD
    all_sass_bundles: './app/stylesheets/**/[^_]*.s[ac]ss'

    # path to where the manifest should be generated
    bundles_with_deps: public/dist/brandable_css/bundles_with_deps.json

    # path to where the internal cache file should be generated; this is used
    # internally by brandable_css to tell which stylesheets needs to be
    # reprocessed on successive runs
    file_checksums: tmp/brandable_css_file_checksums.json

    # directory that will contain the processed variant bundle files: this is
    # what can be served to the user
    output_dir: public/dist/brandable_css

    # path to the file that contains the mapping of supported browsers to be
    # passed to [autoprefixer], which may look like this:
    # 
    #     minimums:
    #       chrome: 83
    #       safari: 12
    #       firefox: 78
    #
    # [autoprefixer]: https://autoprefixer.github.io/
    browsers_yml: config/browsers.yml
```
