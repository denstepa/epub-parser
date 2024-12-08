import fs from 'fs'
import xml2js from 'xml2js'
import _ from 'lodash'
// @ts-ignore
import nodeZip from 'node-zip'
import parseLink from './parseLink'
import parseSection, { Section } from './parseSection'
import { EPubFileOptions, EPubFileType, GeneralObject, InitialMetadata, StructureItemType } from './types'
import parseHTML from './parseHTML'
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown'

const xmlParser = new xml2js.Parser()

const xmlToJs = (xml: string) => {
  return new Promise<any>((resolve, reject) => {
    xmlParser.parseString(xml, (err: Error | null, object: GeneralObject) => {
      if (err) {
        reject(err)
      } else {
        resolve(object)
      }
    })
  })
}

const determineRoot = (opfPath: string) => {
  let root = ''
  // set the opsRoot for resolving paths
  if (opfPath.match(/\//)) {
    // not at top level
    root = opfPath.replace(/\/([^\/]+)\.opf/i, '')
    if (!root.match(/\/$/)) {
      root += '/'
    }
    if (root.match(/^\//)) {
      root = root.replace(/^\//, '')
    }
  }
  return root
}

const parseMetadata = (metadata: GeneralObject[]) => {
  const title = _.get(metadata[0], ['dc:title', 0]) as string
  let author = _.get(metadata[0], ['dc:creator', 0]) as string

  if (typeof author === 'object') {
    author = _.get(author, ['_']) as string
  }

  const publisher = _.get(metadata[0], ['dc:publisher', 0]) as string
  const meta = {
    title,
    author,
    publisher,
  }
  return meta
}

class StructureItem {
  name: string
  sectionId?: string
  nodeId?: string
  nextNodeId?: string
  path: string
  playOrder?: number
  children?: StructureItem[]
  filePath?: string
  content?: any
  markdownContent?: string

  constructor(item: StructureItemType) {
    this.name = item.name;
    this.sectionId = item.sectionId;
    this.nodeId = item.nodeId;
    this.nextNodeId = item.nextNodeId;
    this.path = item.path;
    this.playOrder = item.playOrder;
    this.children = item.children;
    this.filePath = item.filePath;
    this.content = item.content;
    this.markdownContent = item.markdownContent;
  }

}

class EPubFile {
  name: string;
  dir: boolean;
  date: Date;
  comment: string | null;
  unixPermissions: string | null;
  dosPermissions: number;
  _data: string;
  options: EPubFileOptions;
  _initialMetadata: InitialMetadata;
  dom?: JSDOM;
  document?: Document;

  constructor(options: EPubFileType) {
    this.name = options.name;
    this.dir = options.dir;
    this.date = options.date;
    this.comment = options.comment;
    this.unixPermissions = options.unixPermissions;
    this.dosPermissions = options.dosPermissions;
    this._data = options._data;
    this.options = options.options;
    this._initialMetadata = options._initialMetadata;
  }

  getHTMLDocument(): Document {
    if (this.document != undefined) {
      return this.document;
    }
    const htmlContent = this._data;
    this.dom = new JSDOM(htmlContent);
    this.document = this.dom.window.document;
    return this.document;
  }

}

export class Epub {
  private _zip: any // nodeZip instance
  private _opfPath?: string
  private _root?: string
  private _content?: GeneralObject
  private _manifest?: any[]
  private _spine?: string[] // array of ids defined in manifest
  private _toc?: GeneralObject
  private _metadata?: GeneralObject
  private turndownService: TurndownService
  structure?: StructureItem[];
  info?: {
    title: string
    author: string
    publisher: string
  }
  sections?: Section[]
  files: { [key: string]: EPubFile }

  constructor(buffer: Buffer) {
    this._zip = new nodeZip(buffer, { binary: true, base64: false, checkCRC32: true })
    this.files = {}
    _.mapKeys(this._zip.files, (value: EPubFile, key: string) => {
      this.files[key] = new EPubFile(value)
    })

    this.turndownService = new TurndownService();
  }

  getFile(item: StructureItem): EPubFile {
    return this.files[item.filePath!] as EPubFile;
  }

  resolve(path: string): { asText: () => string } {
    let _path
    if (path[0] === '/') {
      // use absolute path, root is zip root
      _path = path.substr(1)
    } else {
      _path = this._root + path
    }
    const file = this._zip.file(decodeURI(_path))
    if (file) {
      return file
    } else {
      throw new Error(`${_path} not found!`)
    }
  }

  async _resolveXMLAsJsObject(path: string) {
    const xml = this.resolve(path).asText()
    return xmlToJs(xml)
  }

  private async _getOpfPath() {
    const container = await this._resolveXMLAsJsObject('/META-INF/container.xml')
    const opfPath = container.container.rootfiles[0].rootfile[0]['$']['full-path']
    return opfPath
  }

  _getManifest(content: GeneralObject) {
    return _.get(content, ['package', 'manifest', 0, 'item'], []).map(
      (item: any) => item.$,
    ) as any[]
  }

  _resolveIdFromLink(href: string) {
    const { name: tarName } = parseLink(href)
    const tarItem = _.find(this._manifest, (item) => {
      const { name } = parseLink(item.href)
      return name === tarName
    })
    return _.get(tarItem, 'id')
  }

  _getSpine() {
    return _.get(this._content, ['package', 'spine', 0, 'itemref'], []).map(
      (item: GeneralObject) => {
        return item.$.idref
      },
    )
  }

  _genStructureForHTML(tocObj: GeneralObject): StructureItem[] {
    const tocRoot = tocObj.html.body[0].nav[0]['ol'][0].li;
    let runningIndex = 1;

    const parseHTMLNavPoints = (navPoint: GeneralObject): StructureItem => {
      const element = navPoint.a[0] || {};
      const path = element['$'].href;
      let name = element['_'];
      const prefix = element.span;
      if (prefix) {
        name = `${prefix.map((p: GeneralObject) => p['_']).join('')}${name}`;
      }
      const sectionId = this._resolveIdFromLink(path);
      const { hash: nodeId } = parseLink(path)
      const playOrder = runningIndex;

      let children = navPoint?.ol?.[0]?.li;

      if (children) {
        children = parseOuterHTML(children);
      }

      runningIndex++;

      return new StructureItem({
        name,
        sectionId,
        nodeId,
        path,
        playOrder,
        children,
      }); 
    };

    const parseOuterHTML = (collection: GeneralObject[]): StructureItem[] => {
      return collection.map((point) => {
        return parseHTMLNavPoints(point);
      });
    }

    return parseOuterHTML(tocRoot);
  }

  _genStructure(tocObj: GeneralObject, resolveNodeId = false): StructureItem[] {
    if (tocObj.html) {
      return this._genStructureForHTML(tocObj);
    }

    const rootNavPoints = _.get(tocObj, ['ncx', 'navMap', '0', 'navPoint'], [])

    const parseNavPoint = (navPoint: GeneralObject): StructureItem => {
      // link to section
      const path = _.get(navPoint, ['content', '0', '$', 'src'], '')
      const name = _.get(navPoint, ['navLabel', '0', 'text', '0'])
      const playOrder = _.get(navPoint, ['$', 'playOrder']) as number
      const { hash: nodeId } = parseLink(path)
      let children = navPoint.navPoint

      if (children) {
        // tslint:disable-next-line:no-use-before-declare
        children = parseNavPoints(children)
      }

      const sectionId = this._resolveIdFromLink(path)

      return new StructureItem({
        name,
        sectionId,
        nodeId,
        path,
        playOrder,
        children,
      })
    }

    const parseNavPoints = (navPoints: GeneralObject[]) => {
      return navPoints.map((point) => {
        return parseNavPoint(point)
      })
    }

    return parseNavPoints(rootNavPoints)
  }

  _resolveSectionsFromSpine(expand = false) {
    // no chain
    return _.map(_.union(this._spine), (id) => {
      const path = _.find(this._manifest, { id }).href
      const html = this.resolve(path).asText()

      return parseSection({
        id,
        htmlString: html,
        resourceResolver: this.resolve.bind(this),
        idResolver: this._resolveIdFromLink.bind(this),
        expand,
      })
    })
  }

  async parse(expand = false) {
    const opfPath = await this._getOpfPath()
    this._root = determineRoot(opfPath)

    const content = await this._resolveXMLAsJsObject('/' + opfPath)
    const manifest = this._getManifest(content)
    const metadata = _.get(content, ['package', 'metadata'], [])
    const tocID = _.get(content, ['package', 'spine', 0, '$', 'toc']);

    // https://github.com/gaoxiaoliangz/epub-parser/issues/13
    // https://www.w3.org/publishing/epub32/epub-packages.html#sec-spine-elem

    let tocPath: string;
    if (tocID) {
      tocPath = (_.find(manifest, { id: tocID }) || {}).href
    } else {
      // Based on the EPUB spec, the toc file should be declared in the manifest with the property 'nav'
      // https://www.w3.org/TR/epub/#sec-nav-prop
      tocPath = _.find(manifest, { properties: 'nav'})?.href
    }

    if (tocPath) {
      const toc = await this._resolveXMLAsJsObject(tocPath)
      this._toc = toc
      this.structure = this._genStructure(toc)
      this._getStructureContent()
    }

    this._manifest = manifest
    this._content = content
    this._opfPath = opfPath
    this._spine = this._getSpine()
    this._metadata = metadata
    this.info = parseMetadata(metadata)
    this.sections = this._resolveSectionsFromSpine(expand)
    return this
  }

  resolvePath = (path: string): string => {
    return this._root ? `${this._root}${path}` : path;
  }


  _getStructureContent() {
    if (!this.structure) {
      return;
    }

    let structure = this.structure

    let flatStructure = flattenStructureItems(structure)

    console.log('flat Structure', flatStructure)

    flatStructure = flatStructure.map((item: StructureItem) => {
      const path = this.resolvePath(item.path.split('#').shift() as string)
      item.filePath = path;
      return item;
    })

    console.log('file names found')

    if (_.every(flatStructure, { filePath: flatStructure[0].filePath })) {
      console.log('parse content from same file')
      this.structure = this._getContentFromSameFile(structure)
    } else {
      console.log('parse content from separate file')
      this.structure = this._getContentPerFile(structure)
      // TODO: find files in Spine that are between files that are tagged.
    }
    console.log('structure parsed')
  }

  _getContentFromSameFile(items: StructureItem[], nextParent?: StructureItem): StructureItem[] {

    const itemsWithContent = items.map((item: StructureItem, index: number) => {
      const path = this.resolvePath(item.path.split('#').shift() as string);
      item.filePath = path;
      return item;
    }).map((item: StructureItem, index: number, items: StructureItem[]) => {
      const nextItem = items[index + 1]
      if (item.nodeId != null) {
        if (nextItem && nextItem.nodeId != null && item.filePath === nextItem.filePath) {
          item.nextNodeId = nextItem.nodeId;
        } else if (nextParent && nextParent.nodeId != null && item.filePath === nextParent.filePath) {
          item.nextNodeId = nextParent.nodeId;
        }
        item.content = this.getHTMLNodesBetweenNodes(item);
        item.markdownContent = item.content && this.turndownService!.turndown(item.content)
        // console.log('item.content', item.name, item.nodeId, item.nextNodeId, item.content && turndownService.turndown(item.content))  
      }

      if (item.children) {
        item.children = this._getContentFromSameFile(item.children, nextItem);
      }
      return item;
    });

    // console.log('itemsWithContent[0]', itemsWithContent[0])
    return itemsWithContent;
  }

  _getContentPerFile(items: StructureItem[]): StructureItem[] {
    const itemsWithContent = items.map((item: StructureItem, index: number) => {
      const path = this.resolvePath(item.path.split('#').shift() as string);
      item.filePath = path;
      return item;
    }).map((item: StructureItem, index: number) => {
      const file = this.getFile(item)
      const nextItem = items[index + 1]

      item.content = file._data;
      item.markdownContent = item.content && this.turndownService!.turndown(item.content)

      if (item.children) {
        item.children = this._getContentPerFile(item.children);
      }
      return item;
    });

    return itemsWithContent;
  }

  getHTMLNodesBetweenNodes(item: StructureItem): string | undefined {
    const file = this.getFile(item)
    const document = file.getHTMLDocument()
  
    const currentNode: HTMLElement | null = document.getElementById(item.nodeId!);
    const nextNode: HTMLElement | null = document.getElementById(item.nextNodeId!);
    if (currentNode) {
      const elementsBetween = [];
      let node = currentNode;
      // console.log('node', node, node?.textContent, node?.nodeType, node === nextNode)
  
      while (node && (node !== nextNode || node != null)) {
        if (node.nodeType === 1) {
          elementsBetween.push(node);
        }
        node = node.nextSibling as HTMLElement;
        // console.log('node', node, node?.textContent, node?.nodeType, node === nextNode)
      }
  
      // wrap elements in a div
      // create a new document fragment
      // Create new document and wrapper
      // const newDoc = document.implementation.createHTMLDocument();
      // const wrapper = newDoc.createElement('div');

      // // Clone and append each element
      // elementsBetween.forEach((element) => {
      //   const clonedElement = element.cloneNode(true); // Deep clone with all children
      //   wrapper.appendChild(clonedElement);
      // });
  
      return getHTMLString(elementsBetween);
    }
    return undefined
  }
}

const getHTMLString = (elementsBetween: HTMLElement[]): string => {
  const elements = elementsBetween
    .map(element => element.outerHTML)
    .join('\n');
  return `<div>${elements}</div>`;
}

function flattenStructureItems(items: StructureItem[]): StructureItem[] {
  const result: StructureItem[] = [];

  function flatten(item: StructureItem) {
    result.push(item);
    if (item.children) {
      item.children.forEach(flatten);
    }
  }

  items.forEach(flatten);
  return result;
}

export interface ParserOptions {
  type?: 'binaryString' | 'path' | 'buffer'
  expand?: boolean
}
export default function parserWrapper(target: string | Buffer, options: ParserOptions = {}) {
  // seems 260 is the length limit of old windows standard
  // so path length is not used to determine whether it's path or binary string
  // the downside here is that if the filepath is incorrect, it will be treated as binary string by default
  // but it can use options to define the target type
  const { type, expand } = options
  let _target = target
  if (type === 'path' || (typeof target === 'string' && fs.existsSync(target))) {
    _target = fs.readFileSync(target as string, 'binary')
  }
  return new Epub(_target as Buffer).parse(expand)
}
