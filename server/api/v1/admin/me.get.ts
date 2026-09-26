/** The signed-in staff member and their permissions: the admin app's session check. */
export default defineEventHandler(event => requireStaff(event))
