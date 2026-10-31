# Staff

**Admin → Staff** lists everyone with access to the admin portal or the counter app. Search by name or email; filter by role and branch. Click a name to change their access.

## Roles

| Role | What they can do |
|---|---|
| **Admin** | Everything: this admin portal (menu, staff, branch, payments), and the counter app at every branch, including cancelling paid orders. Only admins can sign in to the admin portal. |
| **Manager** (per branch) | Everything Staff do at their branches, plus **Manage** in the counter app: the branch's **Dining tables** and QR codes, and its **Reports** (view and print; no CSV or Telegram). They can't change opening hours, the menu or staff. |
| **Staff** (per branch) | The counter app at their branches: take payments, prepare and complete orders, cancel orders, mark items sold out. |

Admins work at every branch, so they need no branch. With two branches or more, a person can have **different roles per branch** (Manager at one, Staff at another).

Branches are the locations of your cafe: they share one menu, one staff list and the same customers; each has its own hours, tables, counter and orders.

## Add a staff member

1. Press **Add staff member** (or **N**).
2. **Name** and **Email**.
3. Under **Access** choose **Admin**, **Manager** or **Staff**. For a Manager or Staff, tick their **Branches**. To give someone a different role at each branch, choose **Different per branch**, then press **Add branch** and pick the branch and role for each.
4. Press **Add**, then **Copy** the **Temporary password** that appears and give it to the person in person or through a private channel. It won't be shown again, so this step is part of adding them.
5. At their first sign-in they must choose their own password.

If the email already belongs to a customer account (someone who orders on the website), that account gets the access instead; they keep their own password and no temporary password is shown.

Staff sign in to the counter app at `/counter/sign-in`; admins sign in to this portal at `/admin/login`.

## Change someone's access

Click their name, change their **Access** or their branches, then **Save**. The change applies at once.

## Disable a staff member

From their row's menu choose **Disable**. They lose admin and branch access and are signed out everywhere. Their account keeps working as a customer account, and you can give them access again later with **Add staff member** and the same email.

## Reset a forgotten password

From their row's menu choose **Reset password**, then confirm. A **Temporary password** appears: **Copy** it and give it to the person in person or through a private channel. It won't be shown again. Their old password stops working at once and they are signed out everywhere (the admin portal and the counter app). At their next sign-in they must choose a new password.

You can't reset your own password here: use **Change password** in your account menu.

## Two-step sign-in

The **Two-step** column shows who signs in with a code from an authenticator app as well as their password (**On**) and who doesn't (**Off**); on a phone, a shield with "Two-step sign-in" under the person's access. Each person turns it on or off for themselves, from **Account security** in their user menu (in this portal or in the counter app). You can't turn it on or off for someone else here.

## Common problems

- **"The cafe needs at least one admin. Make someone else an admin first."**: you can't remove or disable the last admin.
- **"You can't remove your own admin role."**: another admin must do it.
- **"Pick at least one branch"**: a Manager or Staff needs a branch; tick one, or choose **Admin**.
- **"This person already has staff access. Edit them instead."**: find them in the list and change their access.
- **A staff member forgot their password**: use **Reset password** from their row's menu (above).
- **"You can't reset your own password here."**: use **Change password** in your account menu.
