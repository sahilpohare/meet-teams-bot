import * as fs from 'fs/promises';
import * as path from 'path';
import { createWorker } from 'tesseract.js';
import { Logger } from './logger';

interface FrameResult {
    timestamp: number;
    text: string;
}

export class FrameAnalyzer {
    private static instance: FrameAnalyzer | null = null;
    private worker: Tesseract.Worker | null = null;
    private isInitialized: boolean = false;
    private framesOcrResults: FrameResult[] = [];

    private constructor() {}

    public static getInstance(): FrameAnalyzer {
        if (!FrameAnalyzer.instance) {
            FrameAnalyzer.instance = new FrameAnalyzer();
        }
        return FrameAnalyzer.instance;
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return;

        console.log('Initializing Frame Analyzer...');
        try {
            this.worker = await createWorker('eng');
            this.isInitialized = true;
            console.log('Frame Analyzer initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Frame Analyzer:', error);
            throw error;
        }
    }

    public async processNewFrame(filePath: string, timestamp: number): Promise<void> {
        if (!this.worker) {
            console.error('Frame Analyzer not initialized');
            return;
        }
    
        try {
            console.log(`Processing frame from ${timestamp}`);
    
            console.log('Processing frame from:', filePath);
            // Vérifier si le fichier existe avant de le traiter
            try {
                await fs.access(filePath);
            } catch (err) {
                console.error(`File does not exist: ${filePath}`);
                return;
            }
    
            const { data: { text } } = await this.worker.recognize(filePath);
            
            // Stocker le résultat
            this.framesOcrResults.push({
                timestamp,
                text: text || ''
            });
            console.log('OCR results:', this.framesOcrResults);
    
            // Ne garder que les 10 derniers résultats (configurable)
            if (this.framesOcrResults.length > 10) {
                this.framesOcrResults.shift();
            }
    
            // Supprimer immédiatement le fichier après l'OCR
            await fs.unlink(filePath);
            console.log(`Frame processed and deleted: ${filePath}`);
        } catch (error) {
            console.error(`Error processing frame ${filePath}:`, error);
        }
    }
    

    public getLastFrameText(): string | null {
        if (this.framesOcrResults.length === 0) {
            return null;
        }
        return this.framesOcrResults[this.framesOcrResults.length - 1].text;
    }

    public getAllResults(): FrameResult[] {
        return [...this.framesOcrResults];
    }

    public async getFramesDirectory(): Promise<string> {
        if (!Logger.instance) {
            throw new Error('Logger not initialized');
        }
        
        const framesDir = path.join(path.dirname(Logger.instance.get_video_directory()), 'frames');
        
        try {
            await fs.mkdir(framesDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create frames directory:', error);
        }
    
        return framesDir;
    }

    public async cleanup(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        this.isInitialized = false;
        this.framesOcrResults = [];
        console.log('Frame Analyzer cleaned up');
    }
}