// scripts/generate-icons.mjs
import fs from 'fs/promises';
import sharp from 'sharp';
import path from 'path';

// Logo ratio 590:180 ≈ 3.28:1 (width:height)
const DESIGN_RATIO = 590/180;
const SQUARE_RATIO = 1;

const ICON_SIZES = [16, 32, 48, 96, 128, 256, 512];
const VARIANTS = [
  { 
    svg: 'design-dark.svg',
    prefix: 'design-dark',
    ratio: DESIGN_RATIO
  },
  {
    svg: 'design-light.svg',
    prefix: 'design-light',
    ratio: DESIGN_RATIO
  },
  {
    svg: 'square-dark.svg',
    prefix: 'square-dark',
    ratio: SQUARE_RATIO
  },
  {
    svg: 'square-light.svg',
    prefix: 'square-light',
    ratio: SQUARE_RATIO
  }
];

async function generateIcons() {
  const iconDir = path.join(process.cwd(), 'public/icon');
  
  for (const variant of VARIANTS) {
    const svgPath = path.join(iconDir, variant.svg);
    const svgBuffer = await fs.readFile(svgPath);
    
    for (const size of ICON_SIZES) {
      const pngFilename = `px${size}-${variant.prefix}.png`;
      const outputPath = path.join(iconDir, pngFilename);
      
      // Calculate dimensions based on WIDTH-first approach
      const width = size;
      const height = Math.round(width / variant.ratio);
      
      await sharp(svgBuffer)
        .resize({
          width,
          height,
          fit: 'contain',
          position: 'left',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toFile(outputPath);
      
      console.log(`Generated: ${pngFilename} (${width}x${height})`);
    }
  }
}

generateIcons().catch(console.error);