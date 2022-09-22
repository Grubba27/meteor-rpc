function createMethod() {
  throw new Error('createMethod is not available on the client');
}

function createPublication() {
  throw new Error('createPublication is not available on the client');
}

export {
  createMethod,
  createPublication,
}
