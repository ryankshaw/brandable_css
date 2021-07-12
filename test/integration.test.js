const path = require('path')
const fsX = require('fs-extra-promise')
const { assert } = require('chai')

describe('brandable_css', () => {
  const dist = path.resolve(__dirname, '../tmp/dist')

  before(async () => {
    process.env.BRANDABLE_CSS_CONFIG_FILE = path.resolve(__dirname, 'fixture/config/brandable_css.yml')

    const { checkAll } = require('../src/main')

    await fsX.emptyDir(dist)
    await checkAll()
  })

  after(async () => {
    await fsX.emptyDir(dist)
    process.env.BRANDABLE_CSS_CONFIG_FILE = undefined
  })

  it('generates the manifest', async () => {
    const manifest = JSON.parse(
      fsX.readFileSync(
        path.resolve(dist, 'bundles_with_deps.jsonnested'),
        'utf8'
      )
    )

    assert.deepEqual(manifest, {
      "a.scss$$$$$$$$$$$high_contrast": {
        "combinedChecksum": "847ced33a4",
        "includedFiles": [
          "a.scss"
        ],
        "includesNoVariables": true
      },
      "b.scss$$$$$$$$$$$normal_contrast": {
        "combinedChecksum": "40d5ecf9cb",
        "includedFiles": [
          "b.scss",
          "variants/normal_contrast/_variant_variables.scss"
        ],
        "includesNoVariables": false
      },
      "a.scss$$$$$$$$$$$normal_contrast": {
        "combinedChecksum": "847ced33a4",
        "includedFiles": [
          "a.scss"
        ],
        "includesNoVariables": true
      },
      "b.scss$$$$$$$$$$$high_contrast": {
        "combinedChecksum": "fff8a69e40",
        "includedFiles": [
          "b.scss",
          "variants/high_contrast/_variant_variables.scss"
        ],
        "includesNoVariables": false
      }
    })
  })

  it('generates variant stylesheets for files that use variables', () => {
    assert.ok(fsX.existsSync(path.resolve(dist, 'high_contrast/b-fff8a69e40.css')))
    assert.ok(fsX.existsSync(path.resolve(dist, 'normal_contrast/b-40d5ecf9cb.css')))
  })

  it('variants as "no_variables" for files that use no variables', () => {
    assert.ok(fsX.existsSync(path.resolve(dist, 'no_variables/a-847ced33a4.css')))
  })
})
