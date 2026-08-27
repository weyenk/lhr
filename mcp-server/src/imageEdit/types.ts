export interface ImageEditProvider {
  compositeProductIntoPhoto(input: {
    sourceImageUrl: string;
    productImageUrl: string;
    productName: string;
  }): Promise<{ resultImageUrl: string } | { error: string }>;
}
