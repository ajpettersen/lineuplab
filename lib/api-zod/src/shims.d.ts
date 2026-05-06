declare global {
  interface File extends Blob {
    readonly lastModified: number;
    readonly name: string;
  }
  // eslint-disable-next-line no-var
  var File: {
    prototype: File;
    new (fileBits: BlobPart[], fileName: string, options?: BlobPropertyBag): File;
  };
}

export {};
