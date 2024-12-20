export interface GeneralObject {
  [key: string]: any
}

export interface HtmlNodeObject {
  tag?: string
  type: 1 | 3
  text?: string
  children?: HtmlNodeObject[]
  attrs: {
    id: string
    href: string
    src: string
  }
}

export type StructureItemType = {
  name: string,
  sectionId?: string,
  nodeId?: string,
  nextNodeId?: string,
  path: string
  playOrder?: number,
  children?: StructureItemType[]
  filePath?: string
  content?: any
  markdownContent?: string
}

export interface EPubFileType {
  name: string;
  dir: boolean;
  date: Date;
  comment: string | null;
  unixPermissions: string | null;
  dosPermissions: number;
  _data: string;
  options: EPubFileOptions;
  _initialMetadata: InitialMetadata;
}

export interface EPubFileOptions {
  binary: boolean;
  optimizedBinaryString: boolean;
  date: Date;
  dir: boolean;
  comment: string | null;
  unixPermissions: string | null;
  dosPermissions: number;
  createFolders: boolean;
  base64: boolean;
  compression: string | null;
  compressionOptions: string | null;
}

export interface InitialMetadata {
  dir: boolean;
  date: Date;
}

export interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
  fallback?: string
}