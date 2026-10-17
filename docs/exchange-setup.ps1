# Limits the booking app to ONE mailbox using Exchange Online RBAC for Applications.
# Without this, an app with Calendars.ReadWrite could read and write every calendar in your tenant.
#
# Run in PowerShell as an Exchange admin. Fill in the four values first.

$AppId       = "00000000-0000-0000-0000-000000000000"  # Application (client) ID from the app registration
$ObjectId    = "00000000-0000-0000-0000-000000000000"  # Object ID from Entra > Enterprise applications (NOT the app registration)
$Mailbox     = "you@yourdomain.com"                    # The calendar that takes bookings (same as MAILBOX)
$DisplayName = "Outlook Teams Booking"

Install-Module ExchangeOnlineManagement -Scope CurrentUser   # skip if already installed
Connect-ExchangeOnline

# 1. Tell Exchange about the app
New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName $DisplayName

# 2. A scope containing just the booking mailbox
New-ManagementScope -Name "$DisplayName Scope" -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'"

# 3. Grant calendar and send mail rights, limited to that scope
New-ManagementRoleAssignment -App $AppId -Role "Application Calendars.ReadWrite" -CustomResourceScope "$DisplayName Scope"
New-ManagementRoleAssignment -App $AppId -Role "Application Mail.Send" -CustomResourceScope "$DisplayName Scope"

# 4. Optional: allow sending from aliases (needed for per-site sender addresses)
Set-OrganizationConfig -SendFromAliasEnabled $true

# 5. Check it worked. Should show InScope = True for both roles.
Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox

# Permission changes can take 30 minutes or so to apply.
