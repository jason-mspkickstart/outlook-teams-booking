# Limits the booking app to ONE mailbox using Exchange Online RBAC for Applications.
# Without this, an app with Calendars.ReadWrite could read and write every calendar in your tenant.
#
# Run in PowerShell as a Global or Exchange admin. Fill in the two values first.
# Safe to run again if something fails part way.

$AppId       = "00000000-0000-0000-0000-000000000000"  # Application (client) ID from the app registration
$Mailbox     = "you@yourdomain.com"                    # The calendar that takes bookings (same as MAILBOX)
$DisplayName = "Outlook Teams Booking"
$ScopeName   = "$DisplayName Scope"

# Modules (skip the installs if you already have them)
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Install-Module Microsoft.Graph.Applications -Scope CurrentUser

# 1. Find the enterprise application's Object ID. This is NOT the Object ID on the
#    app registration page, which is the usual cause of "ServicePrincipalNotFound".
Connect-MgGraph -Scopes "Application.ReadWrite.All"
$sp = Get-MgServicePrincipal -Filter "appId eq '$AppId'"
if (-not $sp) { $sp = New-MgServicePrincipal -AppId $AppId }
$ObjectId = $sp.Id
Write-Host "Enterprise app Object ID: $ObjectId"

Connect-ExchangeOnline

# 2. Tell Exchange about the app
if (-not (Get-ServicePrincipal -Identity $AppId -ErrorAction SilentlyContinue)) {
    New-ServicePrincipal -AppId $AppId -ObjectId $ObjectId -DisplayName $DisplayName
}

# 3. A scope containing just the booking mailbox
if (-not (Get-ManagementScope -Identity $ScopeName -ErrorAction SilentlyContinue)) {
    New-ManagementScope -Name $ScopeName -RecipientRestrictionFilter "PrimarySmtpAddress -eq '$Mailbox'"
}

# 4. Grant calendar and send mail rights, limited to that scope
foreach ($role in "Application Calendars.ReadWrite", "Application Mail.Send") {
    $existing = Get-ManagementRoleAssignment -RoleAssignee $ObjectId -Role $role -ErrorAction SilentlyContinue
    if (-not $existing) {
        New-ManagementRoleAssignment -App $AppId -Role $role -CustomResourceScope $ScopeName
    }
}

# 5. Allow sending from aliases (needed if sites send confirmation emails from alias addresses)
Set-OrganizationConfig -SendFromAliasEnabled $true

# 6. Check it worked. Both rows should show InScope = True.
Test-ServicePrincipalAuthorization -Identity $AppId -Resource $Mailbox

# Permission changes can take 30 minutes or so to apply.
