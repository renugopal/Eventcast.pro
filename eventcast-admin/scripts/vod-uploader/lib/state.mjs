import fs from 'fs/promises';
import path from 'path';

export class UploadState {
  constructor(stateDir, slug) {
    this.stateDir = stateDir;
    this.slug = slug;
    this.filePath = path.join(stateDir, `${slug}.json`);
    this.data = null;
  }

  async load() {
    if (this.data) return this.data;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch {
      this.data = { uploaded: {}, stats: { total: 0, bytes: 0 } };
    }
    return this.data;
  }

  async save() {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  async isUploaded(fileName) {
    await this.load();
    return Boolean(this.data.uploaded[fileName]);
  }

  async markUploaded(fileName, bytes) {
    await this.load();
    if (!this.data.uploaded[fileName]) {
      this.data.stats.total += 1;
      this.data.stats.bytes += bytes;
    }
    this.data.uploaded[fileName] = {
      at: new Date().toISOString(),
      bytes,
    };
    await this.save();
  }

  async listPending(localFiles) {
    await this.load();
    return localFiles.filter((f) => !this.data.uploaded[f.name]);
  }
}
