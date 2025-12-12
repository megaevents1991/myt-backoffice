"use server";

import fs from 'fs';
import path from 'path';

export async function getDynamicMaps() {
  const publicDir = path.join(process.cwd(), 'public');
  let maps: { name: string; path: string }[] = [];

  try {
    if (fs.existsSync(publicDir)) {
      const files = fs.readdirSync(publicDir);

      maps = files
        .filter(file => file.toLowerCase().endsWith('.svg'))
        .map(file => {
          try {
            const filePath = path.join(publicDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            return {
              name: file,
              path: '/' + file,
              content: content
            };
          } catch (e) {
            console.error(`Error reading file ${file}:`, e);
            return null;
          }
        })
        .filter((map): map is { name: string; path: string; content: string } => 
          map !== null && map.content.includes('data-section')
        )
        .map(({ name, path }) => ({ name, path }));
    }
  } catch (error) {
    console.error("Error reading public directory:", error);
  }

  return maps;
}
