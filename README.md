# Validador PQM Walmart

Aplicación web estática para reemplazar las 27 tablas dinámicas de control del panel PQM por validaciones automáticas y un Excel de alertas.

## Privacidad

El archivo se procesa completamente en el navegador. No se carga a GitHub ni se transmite a un servidor. Los archivos reales de Excel, Word y PowerPoint están excluidos mediante `.gitignore` porque pueden contener datos personales.

## Uso local

```bash
npm install
npm run extract:hierarchy
npm test
npm run dev
```

La aplicación exige un archivo `.xlsx` con la hoja `pqm consolidado` y la estructura del panel. El resultado contiene las hojas `Resumen`, `Alertas` y `Registros_a_revisar`.

## Actualizar la jerarquía

Ubique el archivo `Copia de Jerarquia_Instrucciones_divisiones (2).xlsx` en la raíz local y ejecute:

```bash
npm run extract:hierarchy
```

El comando actualiza únicamente `src/data/hierarchy.json`; el libro fuente permanece ignorado.

## Publicación

Cada push a `main` ejecuta pruebas, compila la aplicación y despliega GitHub Pages.
