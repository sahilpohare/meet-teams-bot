import { S3Uploader } from './S3Uploader'

// Créer une instance unique de S3Uploader
const s3Uploader = new S3Uploader()

/**
 * Upload un fichier vers S3 en utilisant le bucket par défaut
 * @param local Chemin local du fichier
 * @param s3path Chemin S3 où le fichier sera uploadé
 */
export async function s3cp(local: string, s3path: string): Promise<string> {
    return s3Uploader.uploadToDefaultBucket(local, s3path)
}

/**
 * Upload un fichier vers un bucket S3 spécifique
 * @param local Chemin local du fichier
 * @param bucketName Nom du bucket S3
 * @param s3path Chemin S3 où le fichier sera uploadé
 */
export async function s3cpToBucket(local: string, bucketName: string, s3path: string): Promise<string> {
    return s3Uploader.uploadFile(local, bucketName, s3path)
}

/**
 * Upload un répertoire entier vers S3
 * @param localDir Répertoire local à uploader
 * @param bucketName Nom du bucket S3
 * @param s3Prefix Préfixe S3 où les fichiers seront uploadés
 */
export async function s3cpDirectory(localDir: string, bucketName: string, s3Prefix: string): Promise<string[]> {
    return s3Uploader.uploadDirectory(localDir, bucketName, s3Prefix)
}

// Exporter l'instance de S3Uploader pour une utilisation directe si nécessaire
export { s3Uploader } 