export function assign(dest: any, src: any) {
  for (let key in src) {
    dest[key] = src[key]
  }
}
