export interface TransferRecord { id: string; hash: string | null; state: 'ready' | 'attempting' | 'sent' | 'verified' }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nim-relay-transfers', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('transfers', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Your browser could not safely save the transfer. Enable website storage before approving.'))
  })
}
export async function saveTransfer(record: TransferRecord): Promise<void> {
  const db = await open()
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('transfers', 'readwrite')
    transaction.objectStore('transfers').put(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new Error('Could not save transfer recovery information.'))
    transaction.onabort = () => reject(new Error('Transfer recovery storage was interrupted.'))
  }) } finally { db.close() }
}
export async function readTransfer(id: string): Promise<TransferRecord | undefined> {
  const db = await open()
  try { return await new Promise<TransferRecord | undefined>((resolve, reject) => {
    const request = db.transaction('transfers').objectStore('transfers').get(id)
    request.onsuccess = () => resolve(request.result as TransferRecord | undefined)
    request.onerror = () => reject(new Error('Could not read transfer recovery information.'))
  }) } finally { db.close() }
}
