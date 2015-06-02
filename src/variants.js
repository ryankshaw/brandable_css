import config from './config'

const variants = Object.freeze(Object.keys(config.variants))

export default variants
export const BRANDABLE_VARIANTS = new Set(variants.filter((v) => config.variants[v].brandable))