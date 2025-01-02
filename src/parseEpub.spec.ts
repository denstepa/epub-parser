import parser, { Epub, StructureItem } from './parseEpub'
import _ from 'lodash'
import * as path from 'path'
import fs from 'fs'
const baseDir = process.cwd()
const filesToBeTested = ['file-1', 'file-2', 'file-3', 'file-4', 'file-1-no-toc', 'wells']

const testFile = (filename: string) => {
  describe(`parser 测试 ${filename}.epub`, () => {
    const fileContent = parser(path.join(baseDir, `fixtures/${filename}.epub`), {
      type: 'path',
      expand: true,
    })

    test('Result should have keys', async () => {
      const keys = _.keys(await fileContent)
      expect(keys.length).not.toBe(0)
    })

    test('toc', async () => {
      const result = await fileContent
      if (filename === 'file-1-no-toc') {
        expect(result.structure).toBe(undefined)
      } else {
        expect(fileContent && typeof fileContent).toBe('object')
      }
    })

    // it('key 分别为: flesh, nav, meta', done => {
    //   const expectedKeys = ['flesh', 'nav', 'meta']

    //   fileContent.then(result => {
    //     const keys = _.keys(result)
    //     keys.forEach(key => {
    //       expect(expectedKeys.indexOf(key)).to.not.be(-1)
    //     })
    //     done()
    //   })
    // })
  })
}

const saveStructure = (filename: string, structure: StructureItem[]) => {
  const strcuture = _.map(structure, (item: StructureItem) => item.toJSON())
  fs.writeFileSync(filename, JSON.stringify(strcuture))
}

const getJSONStructure = (structure: StructureItem[]) => {
  return _.map(structure, (item: StructureItem) => item.toJSON())
}

describe('parseEpub, - from Google Docs', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/file-no-structure.epub`), {
    type: 'path',
    expand: true,
  })

  test('Result should have structure', async () => {
    const result = await fileContent
    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })

})

describe('get a correct section from ePub', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/file-no-structure.epub`), {
    type: 'path',
    expand: true,
  })

  test('Result should have structure', async () => {
    const result = await fileContent

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })

})

describe('get a correct section from ePub - Bolted', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/Bolted.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = 'fixtures/Bolted.json'
  const overwrite = false

  test('Result should have structure - Bolted', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })

})

describe('get a correct section from ePub - Real File', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/Document.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = 'fixtures/Document.json'
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }
    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })

})

describe('get a correct section from ePub - LittleDovesEbook', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/LittleDovesEbook.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = 'fixtures/LittleDovesEbook.json'
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })

})

describe('get a correct section from ePub - Shelbie Shadowface', () => {
  const fileContent = parser(path.join(baseDir, `fixtures/Shelbie Shadowface.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = 'fixtures/Shelbie Shadowface.json'
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })
})

describe('eBook formatted with Sigil editor', () => {
  // https://sigil-ebook.com/
  const fileName = 'The Romance Rx Kathryn Riya'
  const fileContent = parser(path.join(baseDir, `fixtures/${fileName}.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = `fixtures/${fileName}.json`
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })
})

describe(`Cannot read properties of undefined (reading '0')`, () => {
  const fileName = 'cm4hnfl260000jvz0mosxbih4'
  const fileContent = parser(path.join(baseDir, `fixtures/${fileName}.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = `fixtures/${fileName}.json`
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure) {
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })
})

describe(`Cannot read properties of undefined (reading '0')`, () => {
  const fileName = 'cm2uibxvq00047styajfw39rs'
  const fileContent = parser(path.join(baseDir, `fixtures/${fileName}.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = `fixtures/${fileName}.json`
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure) {
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })
})

describe('eBook formatted with Sigil editor', () => {
  // https://sigil-ebook.com/
  const fileName = '9781641468893'
  const fileContent = parser(path.join(baseDir, `fixtures/${fileName}.epub`), {
    type: 'path',
    expand: true,
  })

  const resultFileName = `fixtures/${fileName}.json`
  const overwrite = false

  test('Result should have structure', async () => {
    const result: Epub = await fileContent

    if (overwrite && result.structure){
      saveStructure(resultFileName, result.structure)
    } else {
      const expectedStructure = JSON.parse(fs.readFileSync(resultFileName, 'utf-8'))
      expect(getJSONStructure(result.structure!)).toEqual(expectedStructure)
    }

    expect(result.structure).not.toBe(undefined)
    expect(fileContent && typeof fileContent).toBe('object')
  })
})

describe('Garbage File - cm2v0d1zn000311039g8acyl9', () => {

  test('Result should have structure', async () => {
    // const fileContent = parser(path.join(baseDir, `fixtures/cm2v0d1zn000311039g8acyl9.epub`), {
    //   type: 'path',
    //   expand: true,
    // })


  //   // expect(await fileContent).rejects.toThrow(`Can't find end of central directory : is this a zip file ? If it is, see http://stuk.github.io/jszip/documentation/howto/read_zip.html`)
  })

})


// filesToBeTested.forEach((filename) => {
//   testFile(filename)
// })
