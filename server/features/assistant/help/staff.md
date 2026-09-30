# Staff

**Admin → Staff** lists everyone with access to the admin portal or the counter app. Search by name or email; filter by role and branch. Click a name to change their access.

## Roles

| Role | What they can do |
|---|---|
| **Admin** | Everything: this admin portal (menu, staff, branch, payments), and the counter app at every branch, including cancelling paid orders. Only admins can sign in to the admin portal. |
| **Manager** (per branch) | The counter app at their branches: take payments, prepare and complete orders, cancel orders, mark items sold out, manage dining tables. |
| **Staff** (per branch) | The counter app at their branches: take payments, prepare and complete orders, cancel orders, mark items sold out. |

A person can have different roles at different branches.

## Add a staff member

1. Press **Add staff member** (or **N**).
2. **Name** and **Email**.
3. Tick **Admin** for full access, and/or under **Branches** press **Add branch**, pick the branch and the role (Manager or Staff).
4. Press **Add**, then **Copy** the **Temporary password** that appears and give it to the person in person or through a private channel. It won't be shown again, so this step is part of adding them.
5. At their first sign-in they must choose their own password.

If the email already belongs to a customer account (someone who orders on the website), that account gets the access instead; they keep their own password and no temporary password is shown.

Staff sign in to the counter app at `/counter/sign-in`; admins sign in to this portal at `/admin/login`.

## Change someone's access

Click their name, change **Admin** or their branches and roles, then **Save**. The change applies at once.

## Disable a staff member

From their row's menu choose **Disable**. They lose admin and branch access and are signed out everywhere. Their account keeps working as a customer account, and you can give them access again later with **Add staff member** and the same email.

## Reset a forgotten password

From their row's menu choose **Reset password**, then confirm. A **Temporary password** appears: **Copy** it and give it to the person in person or through a private channel. It won't be shown again. Their old password stops working at once and they are signed out everywhere (the admin portal and the counter app). At their next sign-in they must choose a new password.

You can't reset your own password here: use **Change password** in your account menu.

## Common problems

- **"The cafe needs at least one admin. Make someone else an admin first."**: you can't remove or disable the last admin.
- **"You can't remove your own admin role."**: another admin must do it.
- **"This person already has staff access. Edit them instead."**: find them in the list and change their access.
- **A staff member forgot their password**: use **Reset password** from their row's menu (above).
- **"You can't reset your own password here."**: use **Change password** in your account menu.
