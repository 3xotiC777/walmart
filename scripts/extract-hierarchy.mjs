import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';

const defaultInput = path.resolve('Copia de Jerarquia_Instrucciones_divisiones (2).xlsx');
const inputPath = path.resolve(process.argv[2] || defaultInput);
const outputPath = path.resolve(process.argv[3] || 'src/data/hierarchy.json');

if (!fs.existsSync(inputPath)) {
  throw new Error(`No se encontró el archivo de jerarquía: ${inputPath}`);
}

const workbook = XLSX.read(fs.readFileSync(inputPath), { cellText: true });
const sheet = workbook.Sheets['Jerarquía'];

if (!sheet) {
  throw new Error('El archivo no contiene la hoja "Jerarquía".');
}

const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  raw: false,
  defval: '',
});

const normalize = (value) => String(value ?? '').trim().toUpperCase();
const entries = {};

for (let index = 1; index < rows.length; index += 1) {
  const row = rows[index];
  const product = normalize(row[1]);
  if (!product) continue;

  const next = {
    producto: product,
    categoria: normalize(row[2]),
    division: normalize(row[3]),
    canasto: normalize(row[4]),
  };

  const current = entries[product];
  if (current && JSON.stringify(current) !== JSON.stringify(next)) {
    throw new Error(`Jerarquía conflictiva para el producto "${product}".`);
  }
  entries[product] = next;
}

const payload = {
  metadata: {
    sourceSheet: 'Jerarquía',
    generatedAt: new Date().toISOString(),
    products: Object.keys(entries).length,
  },
  entries,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Catálogo generado: ${outputPath} (${payload.metadata.products} productos)`);

