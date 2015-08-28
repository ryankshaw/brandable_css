import config from './config'

const variants = Object.freeze(Object.keys(config.variants))
export default variants

const isBrandable = (variant) => config.variants[variant].brandable
export const BRANDABLE_VARIANTS = Object.freeze(new Set(variants.filter(isBrandable)))
