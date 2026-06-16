/**
 * Versión actual de la app, fuente única de verdad para el chequeo de
 * actualizaciones. Vive en una constante (y no se lee de package.json en
 * runtime) porque el `version` de package.json es el genérico de
 * create-next-app y leerlo del disco en producción es frágil; al publicar
 * una release nueva basta con subir este número junto con el tag de GitHub.
 */
export const APP_VERSION = "0.4.3";
