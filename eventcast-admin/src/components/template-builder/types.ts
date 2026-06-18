export type BlockType = 'heading' | 'text' | 'image' | 'button' | 'section';

export interface BuilderBlock {
  id: string;
  type: BlockType;
  content?: string;
  src?: string; // for images
  styles: Record<string, string | number>;
}
