const config = require('./config')

const variants = Object.keys(config.variants)

const isBrandable = (variant) => config.variants[variant].brandable
variants.BRANDABLE_VARIANTS = Object.freeze(new Set(variants.filter(isBrandable)))

module.exports = Object.freeze(variants)
