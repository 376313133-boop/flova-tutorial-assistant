// Local-only storage. Each pause closes a standalone, recoverable media file.
export class RecordingStore {
  constructor() {
    this.ready = new Promise((resolve, reject) => {
      const request = indexedDB.open('flova-tutorial-capture', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('sessions', {keyPath: 'id'});
        const chunks = db.createObjectStore('chunks', {keyPath: ['sessionId', 'take', 'index']});
        chunks.createIndex('sessionId', 'sessionId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async transaction(name, mode, callback) {
    const db = await this.ready;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const request = callback(tx.objectStore(name));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error('Local recording transaction aborted'));
    });
  }
  putSession(meta) { return this.transaction('sessions', 'readwrite', s => s.put(structuredClone(meta))); }
  putChunk(chunk) { return this.transaction('chunks', 'readwrite', s => s.put(chunk)); }
  list() { return this.transaction('sessions', 'readonly', s => s.getAll()); }
  async chunks(id, take) {
    const rows = await this.transaction('chunks', 'readonly', s => s.index('sessionId').getAll(id));
    return rows.filter(row => row.take === take).sort((a,b) => a.index-b.index).map(row => row.blob);
  }
  async remove(id) {
    const db = await this.ready;
    await new Promise((resolve,reject) => {
      const tx = db.transaction(['chunks','sessions'],'readwrite');
      tx.objectStore('sessions').delete(id);
      const request = tx.objectStore('chunks').index('sessionId').openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }
}
