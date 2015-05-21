// these need to match the versions Rails uses.
// If we update either, we need to update it here too
export default [
  "2.2.3", // this is the version of the 'sprockets' gem (from <sprockets dir>/lib/sprockets/version.rb)
  (process.env.RAILS_ENV || 'development') + '-'+ '1.0' // config.assets.version from config/application.rb
]
