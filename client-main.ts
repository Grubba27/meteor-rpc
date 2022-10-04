function createQuery() {
  throw new Error('createQuery is not available on the client');

}

function createMutation() {
  throw new Error('createMutation is not available on the client');

}

function createMethod() {
  throw new Error('createMethod is not available on the client');
}

function createPublication() {
  throw new Error('createPublication is not available on the client');
}

export {
  createMethod,
  createPublication,
  createMutation,
  createQuery,
}
