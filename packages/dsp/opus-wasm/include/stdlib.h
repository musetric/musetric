#ifndef MUSETRIC_STDLIB_H
#define MUSETRIC_STDLIB_H
#include <stddef.h>
#define MUSETRIC_BLOCK_HEADER 16
#define abort() __builtin_trap()
void *__wbindgen_malloc(size_t size, size_t align);
void __wbindgen_free(void *pointer, size_t size, size_t align);
void *realloc(void *pointer, size_t size);
static inline void *malloc(size_t size) {
  size_t *block = __wbindgen_malloc(size + MUSETRIC_BLOCK_HEADER, MUSETRIC_BLOCK_HEADER);
  block[0] = size;
  return (char *)block + MUSETRIC_BLOCK_HEADER;
}
static inline void free(void *pointer) {
  if (pointer) {
    size_t *block = (size_t *)((char *)pointer - MUSETRIC_BLOCK_HEADER);
    __wbindgen_free(block, block[0] + MUSETRIC_BLOCK_HEADER, MUSETRIC_BLOCK_HEADER);
  }
}
static inline int abs(int value) { return value < 0 ? -value : value; }
#endif
