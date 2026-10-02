// Numblox · Optimización de imágenes en el navegador
// Reduce y comprime cada imagen para que quepa en un documento de Firestore (límite 1 MiB),
// conservando la transparencia (WebP con alfa). Así no hace falta Firebase Storage.

const MAX_DATAURL_CHARS = 800000; // margen seguro bajo el límite de 1 MiB por documento

export async function prepareImage(file, kind) {
    const bitmap = await createImageBitmap(file);
    const maxSide = kind === 'background' ? 1920 : 512;
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)); // nunca agranda

    for (let attempt = 0; attempt < 12; attempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        // Primero baja la calidad; si aún pesa demasiado, reduce el tamaño
        for (const quality of [0.92, 0.82, 0.7, 0.6]) {
            const dataUrl = canvas.toDataURL('image/webp', quality);
            if (dataUrl.length <= MAX_DATAURL_CHARS) {
                bitmap.close();
                return dataUrl;
            }
        }
        scale *= 0.8;
    }
    bitmap.close();
    throw new Error('La imagen es demasiado pesada incluso después de optimizarla.');
}