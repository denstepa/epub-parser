import fs from 'fs'
import xml2js from 'xml2js'
import _ from 'lodash'
// @ts-ignore
import nodeZip from 'node-zip'
import parseLink from './parseLink'
import parseSection, { Section } from './parseSection'
import { EPubFileOptions, EPubFileType, GeneralObject, InitialMetadata, ManifestItem, StructureItemType } from './types'
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



export class StructureItem {
  name: string
  sectionId?: string
  nodeId?: string
  nextNodeId?: string
  path: string
  playOrder?: number
  children?: StructureItem[]
  filePath?: string
  content?: any
  sections?: Section[]
  markdownContent?: string

  constructor(item: StructureItemType) {
    this.name = item.name;
    this.sectionId = item.sectionId;
    this.nodeId = item.nodeId;
    this.nextNodeId = item.nextNodeId;
    this.path = item.path;
    this.playOrder = item.playOrder;
    this.children = item.children?.map((child: StructureItemType) => new StructureItem(child));
    this.filePath = item.filePath;
    this.content = item.content;
    this.markdownContent = item.markdownContent;
  }

  toJSON(): StructureItemType {
    return {
      name: this.name,
      sectionId: this.sectionId,
      nodeId: this.nodeId,
      nextNodeId: this.nextNodeId,
      path: this.path,
      playOrder: this.playOrder,
      children: this.children?.map((child: StructureItem) => child.toJSON()),
      filePath: this.filePath,
      markdownContent: this.markdownContent,
    }
  }
}

export class EPubFile {
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
  public isParsed: boolean = false
  
  private _zip: any // nodeZip instance
  private _opfPath?: string
  private _root?: string
  private _content?: GeneralObject
  private _manifest?: ManifestItem[]
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
  public packageVersion?: number;
  createdWith?: string;

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

  getFileByPath(path: string): EPubFile {
    return this.files[path] as EPubFile;
  }

  getSEctionById(id: string): Section | undefined {
    return this.sections?.find((section: Section) => section.id === id);
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

  _getManifest(content: GeneralObject): ManifestItem[] {
    return _.get(content, ['package', 'manifest', 0, 'item'], []).map(
      (item: any) => item.$ as ManifestItem,
    ) as ManifestItem[]
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
  
  _genStructureForHTML_v3(tocPath: string): StructureItem[] {
    const tocContent: string = this.resolve(tocPath).asText()
    const dom = new JSDOM(tocContent);

    const tocRoot: HTMLCollection | undefined = dom.window.document.querySelector('nav[epub:type="toc"] ol')?.children;
    if (tocRoot == undefined) {
      throw new Error('No toc root found');
    }

    let runningIndex = 1;

    const parseHTMLNavPoints = (element: Element): StructureItem => {
      const aElement = element.querySelector('a');
      let name = '';
      let path = '';
      if (aElement != null) {
        path = aElement.getAttribute('href') || '';
        name = _.trim(aElement.textContent || '');  
      }
      const sectionId = this._resolveIdFromLink(path);
      const { hash: nodeId } = parseLink(path)

      const childrenElements: HTMLCollection | undefined = element.querySelector('ol')?.children;
      let children;

      const playOrder = runningIndex;

      if (childrenElements != undefined) {
        children = _.map(childrenElements, parseHTMLNavPoints);
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

    return _.map(tocRoot, parseHTMLNavPoints);  
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
      const path = _.find(this._manifest as ManifestItem[], { id })?.href
      if (!path) {
        throw new Error(`Path not found for id: ${id}`);
      }
      const html = this.resolve(path).asText()

      return parseSection({
        id,
        htmlString: html,
        resourceResolver: this.resolve.bind(this),
        // @ts-ignore
        idResolver: this._resolveIdFromLink.bind(this),
        expand,
      })
    })
  }

  _identifyCreationSoftware(): string | undefined {
    try { 
      const item = _.get(this._metadata, [0, 'meta'], []);
      const sigilVersion = _.find(item, obj => _.get(obj, '$.name') === 'Sigil version')?.$.content;
      if (sigilVersion) {
        return `Sigil ${sigilVersion}`;
      }
    } catch (e) {
      console.error('Error identifying creation software', e);
    }

    return undefined;
  }

  _getTOCPath() {
    const tocID = _.get(this._content, ['package', 'spine', 0, '$', 'toc']);
    // https://github.com/gaoxiaoliangz/epub-parser/issues/13
    // https://www.w3.org/publishing/epub32/epub-packages.html#sec-spine-elem

    if (tocID) {
      return (_.find(this._manifest, { id: tocID }) || {}).href
    } else {
      // Based on the EPUB spec, the toc file should be declared in the manifest with the property 'nav'
      // https://www.w3.org/TR/epub/#sec-nav-prop
      return _.find(this._manifest, { properties: 'nav'})?.href
    }
  }

  async _getTOC_v3() {
    if (this.packageVersion != undefined && this.packageVersion < 3) {
      return undefined;
    }

    // https://www.w3.org/TR/epub/#sec-nav-prop
    // for V3 we should first look at the "nav" property.
    const navItem: ManifestItem | undefined = _.find(this._manifest, { properties: 'nav' })
    if (navItem == undefined) {
      return undefined;
    }
    const tocPath: string = navItem.href;
    const toc = await this._resolveXMLAsJsObject(tocPath);
    this._toc = toc;
    this.structure = this._genStructureForHTML_v3(tocPath);
  }

  async _getTOC() {
    const tocPath: string | undefined = this._getTOCPath()

    if (tocPath != undefined) {
      const toc = await this._resolveXMLAsJsObject(tocPath)
      this._toc = toc
      this.structure = this._genStructure(toc)
    }
  }

  async parse(expand = false) {
    const opfPath = await this._getOpfPath()
    this._root = determineRoot(opfPath)
    this._content = await this._resolveXMLAsJsObject('/' + opfPath)

    this.packageVersion = _.parseInt(_.get(this._content, ['package', '$', 'version']))

    this._manifest = this._getManifest(this._content as GeneralObject)
    this._metadata = _.get(this._content, ['package', 'metadata'], [])
    this.createdWith = this._identifyCreationSoftware()
    
    
    this._opfPath = opfPath
    this._spine = this._getSpine()
    this.info = parseMetadata(this._metadata as GeneralObject[])
    this.sections = this._resolveSectionsFromSpine(expand)

    try {
      if (this.packageVersion != undefined && this.packageVersion >= 3) {
        await this._getTOC_v3()
      }  
    } catch (e) {
      console.error('Error getting TOC for V3', e);
    }
    if (this.structure == undefined) {
      await this._getTOC()
    }
    this._getStructureContent()

    this.isParsed = true

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

    flatStructure = flatStructure.map((item: StructureItem) => {
      const path = this.resolvePath(item.path.split('#').shift() as string)
      item.filePath = path;
      return item;
    })

    if (flatStructure.length === 1) {
      this.structure = [this._getStructureForOneNode(flatStructure[0])]
    } else if (_.every(flatStructure, { filePath: flatStructure[0].filePath })) {
      console.log('parse content from same file')
      this.structure = this._getContentFromSameFile(structure)
    } else {
      console.log('parse content from separate file')
      this.structure = this._getContentPerFile(structure)
      // TODO: find files in Spine that are between files that are tagged.
    }
    // console.log('structure parsed')
  }
  
  _getStructureForOneNode(item: StructureItem): StructureItem {
    const file = this.getFile(item)
    item.content = file._data;
    item.markdownContent = item.content && this.turndownService!.turndown(item.content)
    return item;
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
      return item;
    }).map((item: StructureItem, index: number) => {
      const file = this.getFile(item)
      const nextItem = items[index + 1]

      if (this._spine == null || nextItem == null) {
        const file = this.getFile(item)
        item.content = file._data;
        item.markdownContent = item.content && this.turndownService!.turndown(item.content)
      } else if (item.sectionId == null || nextItem.sectionId == null) {
        const file = this.getFile(item)
        item.content = file._data;
        item.markdownContent = item.content && this.turndownService!.turndown(item.content)
      } else {
        item.sections =  this._getContentBetweenItems(item, nextItem)
        item.content = item.sections.map((section: Section) => section.htmlString!).join('\n');
        item.markdownContent = item.sections.map((section: Section) => section.toMarkdown()).join('\n');
      }

      if (item.children) {
        item.children = this._getContentPerFile(item.children);
      }
      return item;
    });

    return itemsWithContent;
  }

  _getContentBetweenItems(item: StructureItem, nextItem: StructureItem): Section[] {
    // if (this._spine == null || nextItem == null) {
    //   const file = this.getFile(item)
    //   return file._data;
    // }

    // if (item.sectionId == null || nextItem.sectionId == null) {
    //   const file = this.getFile(item)
    //   return file._data;
    // }

    // get elements in spine between item and until nextItem
    const spine = this._spine!;
    const startIndex = spine.indexOf(item.sectionId!);
    const endIndex = spine.indexOf(nextItem.sectionId!);
    const sections: Section[] = _.compact(spine.slice(startIndex, endIndex).map((sectionId: string) => {
      const section: Section | undefined = this.getSEctionById(sectionId);
      return section;
    }));
    // const htmlObjects: HtmlNodeObject[] = _.reduce(sections, (result: HtmlNodeObject[], section: Section | undefined) => {
    //   if (section != undefined && section.htmlObjects != undefined) {
    //     result.push(...section.htmlObjects);
    //   }
    //   return result;
    // }, []);


    // const dom = new JSDOM();
    // const document = dom.window.document;
    // const container = document.createElement('div');
    // htmlObjects.forEach((htmlObject: HtmlNodeObject) => {
    //   const element = document.createElement(htmlObject.tag || 'div');
    //   element.innerHTML = htmlObject.text || '';
    //   // handle children


    //   container.appendChild(element);
    // })
    // return container;
    // return `<div>${sections.map((section: Section) => section.htmlString!).join('\n')}</div>`;
    return sections;
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
  
      while (node && (node !== nextNode )) {
      while (node && (node !== nextNode )) {
        if (node.nodeType === 1) {
          elementsBetween.push(node);
        }
        node = node.nextSibling as HTMLElement;
      }  
      return getHTMLString(elementsBetween);
    }
    return undefined
    }
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
