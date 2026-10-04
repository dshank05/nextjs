// A test may sign someone in: globalThis.__session = { user: { id: '1' } }.
export const getServerSession = async () => globalThis.__session ?? ({ user: {} }); export const authOptions = {}; export default {};
