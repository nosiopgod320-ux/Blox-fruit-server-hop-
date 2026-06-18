--[[
  BloxHop In-Game Server Hopper for Blox Fruits
  Run inside Blox Fruits with any executor (Synapse, KRNL, etc.)
  Click a server card → checks if alive → teleports you there.

  SETUP: Replace API_URL below with your Render service URL.
         Remove the trailing slash if your URL has one.
--]]

local API_URL = "https://bloxhop-api-su5f.onrender.com"  -- NO trailing slash

-- ─────────────────────────────────────────────
--  Services
-- ─────────────────────────────────────────────
local Players          = game:GetService("Players")
local TeleportService  = game:GetService("TeleportService")
local HttpService      = game:GetService("HttpService")
local TweenService     = game:GetService("TweenService")
local RunService       = game:GetService("RunService")

local LocalPlayer = Players.LocalPlayer

-- ─────────────────────────────────────────────
--  Constants
-- ─────────────────────────────────────────────
local PLACE_TO_SEA = {
    [2753915549] = 1,
    [4442272183] = 2,
    [7449423635] = 3,
}
local SEA_TO_PLACE = {
    [1] = 2753915549,
    [2] = 4442272183,
    [3] = 7449423635,
}
local SEA_NAMES  = { [1] = "First Sea",  [2] = "Second Sea", [3] = "Third Sea" }
local SEA_COLORS = {
    [1] = Color3.fromRGB(59, 130, 246),
    [2] = Color3.fromRGB(16, 185, 129),
    [3] = Color3.fromRGB(245, 158, 11),
}
local EVENT_ICONS = {
    fruit = "🍎", castle = "🏰", factory = "⚙️",
    fist = "👊", chalice = "🏆", sword = "⚔️",
}

local ACCENT        = Color3.fromRGB(124, 58, 237)
local ACCENT2       = Color3.fromRGB(168, 85, 247)
local BG            = Color3.fromRGB(14, 14, 18)
local SURFACE       = Color3.fromRGB(23, 23, 31)
local SURFACE2      = Color3.fromRGB(31, 31, 42)
local BORDER        = Color3.fromRGB(42, 42, 56)
local TEXT          = Color3.fromRGB(226, 226, 240)
local MUTED         = Color3.fromRGB(122, 122, 154)
local ALERT_COLOR   = Color3.fromRGB(245, 158, 11)
local ACTIVE_COLOR  = Color3.fromRGB(34, 197, 94)
local RED           = Color3.fromRGB(239, 68, 68)

local currentSea    = PLACE_TO_SEA[game.PlaceId] or 1
local selectedSea   = currentSea
local sortMode      = "event"
local serverData    = {}
local refreshTimer  = 0
local REFRESH_INTERVAL = 30

-- ─────────────────────────────────────────────
--  Utility
-- ─────────────────────────────────────────────
local function fmtSec(s)
    s = math.floor(s or 0)
    if s <= 0 then return "now" end
    local m = math.floor(s / 60)
    local sec = s % 60
    if m == 0 then return sec .. "s" end
    if sec == 0 then return m .. "m" end
    return m .. "m " .. sec .. "s"
end

local function safeUrl(base, path)
    -- Strip trailing slash from base to avoid double-slash
    return base:gsub("/$", "") .. path
end

-- ─────────────────────────────────────────────
--  Remove old GUI if re-running
-- ─────────────────────────────────────────────
local existing = LocalPlayer.PlayerGui:FindFirstChild("BloxHopGui")
if existing then existing:Destroy() end

-- ─────────────────────────────────────────────
--  GUI — Main Frame
-- ─────────────────────────────────────────────
local ScreenGui = Instance.new("ScreenGui")
ScreenGui.Name          = "BloxHopGui"
ScreenGui.ResetOnSpawn  = false
ScreenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
ScreenGui.Parent        = LocalPlayer.PlayerGui

local Main = Instance.new("Frame")
Main.Name             = "Main"
Main.Size             = UDim2.new(0, 520, 0, 540)
Main.Position         = UDim2.new(0.5, -260, 0.5, -270)
Main.BackgroundColor3 = BG
Main.BorderSizePixel  = 0
Main.Active           = true
Main.Draggable        = true
Main.Parent           = ScreenGui
Instance.new("UICorner", Main).CornerRadius = UDim.new(0, 14)
local MainStroke = Instance.new("UIStroke", Main)
MainStroke.Color     = ACCENT
MainStroke.Thickness = 1.5

-- ─── Title Bar ───────────────────────────────
local TitleBar = Instance.new("Frame")
TitleBar.Name              = "TitleBar"
TitleBar.Size              = UDim2.new(1, 0, 0, 46)
TitleBar.BackgroundColor3  = SURFACE
TitleBar.BorderSizePixel   = 0
TitleBar.Parent            = Main
Instance.new("UICorner", TitleBar).CornerRadius = UDim.new(0, 14)
local TitleFix = Instance.new("Frame")
TitleFix.Size             = UDim2.new(1, 0, 0.5, 0)
TitleFix.Position         = UDim2.new(0, 0, 0.5, 0)
TitleFix.BackgroundColor3 = SURFACE
TitleFix.BorderSizePixel  = 0
TitleFix.Parent           = TitleBar

local TitleLabel = Instance.new("TextLabel")
TitleLabel.Size               = UDim2.new(1, -90, 1, 0)
TitleLabel.Position           = UDim2.new(0, 14, 0, 0)
TitleLabel.BackgroundTransparency = 1
TitleLabel.TextColor3         = TEXT
TitleLabel.Font               = Enum.Font.GothamBold
TitleLabel.TextSize           = 14
TitleLabel.TextXAlignment     = Enum.TextXAlignment.Left
TitleLabel.Text               = "🏴‍☠️  BloxHop — Server Hopper"
TitleLabel.Parent             = TitleBar

local StatusDot = Instance.new("Frame")
StatusDot.Size              = UDim2.new(0, 8, 0, 8)
StatusDot.Position          = UDim2.new(1, -68, 0.5, -4)
StatusDot.BackgroundColor3  = MUTED
StatusDot.BorderSizePixel   = 0
StatusDot.Parent            = TitleBar
Instance.new("UICorner", StatusDot).CornerRadius = UDim.new(1, 0)

local CloseBtn = Instance.new("TextButton")
CloseBtn.Size              = UDim2.new(0, 30, 0, 30)
CloseBtn.Position          = UDim2.new(1, -40, 0.5, -15)
CloseBtn.BackgroundColor3  = RED
CloseBtn.TextColor3        = Color3.fromRGB(255, 255, 255)
CloseBtn.Font              = Enum.Font.GothamBold
CloseBtn.TextSize          = 13
CloseBtn.Text              = "✕"
CloseBtn.BorderSizePixel   = 0
CloseBtn.Parent            = TitleBar
Instance.new("UICorner", CloseBtn).CornerRadius = UDim.new(0, 8)
CloseBtn.MouseButton1Click:Connect(function() ScreenGui:Destroy() end)

-- ─── Sea Tabs ────────────────────────────────
local TabBar = Instance.new("Frame")
TabBar.Name             = "TabBar"
TabBar.Size             = UDim2.new(1, 0, 0, 36)
TabBar.Position         = UDim2.new(0, 0, 0, 46)
TabBar.BackgroundColor3 = SURFACE
TabBar.BorderSizePixel  = 0
TabBar.Parent           = Main
local TabLayout = Instance.new("UIListLayout", TabBar)
TabLayout.FillDirection = Enum.FillDirection.Horizontal
TabLayout.SortOrder     = Enum.SortOrder.LayoutOrder

local tabButtons = {}
local function makeTab(label, sea, order)
    local btn = Instance.new("TextButton")
    btn.Name              = "Tab" .. sea
    btn.Size              = UDim2.new(0.333, 0, 1, 0)
    btn.BackgroundColor3  = SURFACE
    btn.BorderSizePixel   = 0
    btn.TextColor3        = MUTED
    btn.Font              = Enum.Font.GothamSemibold
    btn.TextSize          = 11
    btn.Text              = label .. (sea == currentSea and " ◀" or "")
    btn.LayoutOrder       = order
    btn.Parent            = TabBar
    tabButtons[sea]       = btn
end
makeTab("🌊 Sea 1", 1, 1)
makeTab("🌊 Sea 2", 2, 2)
makeTab("🌊 Sea 3", 3, 3)

local TabSep = Instance.new("Frame")
TabSep.Size             = UDim2.new(1, 0, 0, 1)
TabSep.Position         = UDim2.new(0, 0, 0, 82)
TabSep.BackgroundColor3 = BORDER
TabSep.BorderSizePixel  = 0
TabSep.Parent           = Main

-- ─── Sort Bar ────────────────────────────────
local SortBar = Instance.new("Frame")
SortBar.Size             = UDim2.new(1, 0, 0, 32)
SortBar.Position         = UDim2.new(0, 0, 0, 83)
SortBar.BackgroundColor3 = SURFACE2
SortBar.BorderSizePixel  = 0
SortBar.Parent           = Main
local SortLayout = Instance.new("UIListLayout", SortBar)
SortLayout.FillDirection    = Enum.FillDirection.Horizontal
SortLayout.SortOrder        = Enum.SortOrder.LayoutOrder
SortLayout.VerticalAlignment = Enum.VerticalAlignment.Center
SortLayout.Padding          = UDim.new(0, 4)
local SortPad = Instance.new("UIPadding", SortBar)
SortPad.PaddingLeft = UDim.new(0, 10)

local sortBtns = {}
local function makeSortBtn(label, mode, order)
    local btn = Instance.new("TextButton")
    btn.Size             = UDim2.new(0, 90, 0, 22)
    btn.BackgroundColor3 = SURFACE
    btn.BorderSizePixel  = 0
    btn.TextColor3       = MUTED
    btn.Font             = Enum.Font.Gotham
    btn.TextSize         = 10
    btn.Text             = label
    btn.LayoutOrder      = order
    btn.Parent           = SortBar
    Instance.new("UICorner", btn).CornerRadius = UDim.new(0, 6)
    sortBtns[mode]       = btn
end
makeSortBtn("⚡ Next Event", "event",   1)
makeSortBtn("⏱ Age",        "age",     2)
makeSortBtn("👥 Players",   "players", 3)

local CountLabel = Instance.new("TextLabel")
CountLabel.Size              = UDim2.new(0, 90, 1, 0)
CountLabel.BackgroundTransparency = 1
CountLabel.TextColor3        = MUTED
CountLabel.Font              = Enum.Font.Gotham
CountLabel.TextSize          = 10
CountLabel.TextXAlignment    = Enum.TextXAlignment.Left
CountLabel.Text              = ""
CountLabel.LayoutOrder       = 99
CountLabel.Parent            = SortBar

-- ─── Scroll ──────────────────────────────────
local Scroll = Instance.new("ScrollingFrame")
Scroll.Size                   = UDim2.new(1, 0, 1, -148)
Scroll.Position               = UDim2.new(0, 0, 0, 115)
Scroll.BackgroundTransparency = 1
Scroll.BorderSizePixel        = 0
Scroll.ScrollBarThickness     = 4
Scroll.ScrollBarImageColor3   = ACCENT
Scroll.CanvasSize             = UDim2.new(0, 0, 0, 0)
Scroll.AutomaticCanvasSize    = Enum.AutomaticCanvasSize.Y
Scroll.Parent                 = Main
local ScrollLayout = Instance.new("UIListLayout", Scroll)
ScrollLayout.SortOrder = Enum.SortOrder.LayoutOrder
ScrollLayout.Padding   = UDim.new(0, 6)
local ScrollPad = Instance.new("UIPadding", Scroll)
ScrollPad.PaddingLeft   = UDim.new(0, 10)
ScrollPad.PaddingRight  = UDim.new(0, 10)
ScrollPad.PaddingTop    = UDim.new(0, 8)
ScrollPad.PaddingBottom = UDim.new(0, 8)

-- ─── Status Bar ──────────────────────────────
local StatusBar = Instance.new("Frame")
StatusBar.Size             = UDim2.new(1, 0, 0, 28)
StatusBar.Position         = UDim2.new(0, 0, 1, -28)
StatusBar.BackgroundColor3 = SURFACE
StatusBar.BorderSizePixel  = 0
StatusBar.Parent           = Main
local StatusFix = Instance.new("Frame")
StatusFix.Size             = UDim2.new(1, 0, 0.5, 0)
StatusFix.BackgroundColor3 = SURFACE
StatusFix.BorderSizePixel  = 0
StatusFix.Parent           = StatusBar

local StatusLabel = Instance.new("TextLabel")
StatusLabel.Size               = UDim2.new(1, -20, 1, 0)
StatusLabel.Position           = UDim2.new(0, 10, 0, 0)
StatusLabel.BackgroundTransparency = 1
StatusLabel.TextColor3         = MUTED
StatusLabel.Font               = Enum.Font.Gotham
StatusLabel.TextSize           = 10
StatusLabel.TextXAlignment     = Enum.TextXAlignment.Left
StatusLabel.Text               = "Connecting…"
StatusLabel.Parent             = StatusBar

-- ─────────────────────────────────────────────
--  Server Alive Check  (calls /api/check)
-- ─────────────────────────────────────────────
local function checkServerAlive(jobId)
    local ok, result = pcall(function()
        local url = safeUrl(API_URL, "/api/check?jobId=" .. HttpService:UrlEncode(jobId))
        local raw = HttpService:GetAsync(url, true)
        return HttpService:JSONDecode(raw)
    end)
    if not ok then
        -- Network error — assume alive so we still try the teleport
        return true, "network_error"
    end
    return result.alive == true, result.reason
end

-- ─────────────────────────────────────────────
--  Card Builder
-- ─────────────────────────────────────────────
local function createCard(srv, idx)
    local sea     = srv.sea or selectedSea
    local seaCol  = SEA_COLORS[sea] or ACCENT2
    local jobId   = tostring(srv.jobId or "")
    -- IMPORTANT: force integer so TeleportService accepts it
    local placeId = math.floor(tonumber(srv.placeId) or SEA_TO_PLACE[sea] or SEA_TO_PLACE[1])

    local card = Instance.new("Frame")
    card.Name             = "Card_" .. idx
    card.Size             = UDim2.new(1, 0, 0, 0)
    card.AutomaticSize    = Enum.AutomaticSize.Y
    card.BackgroundColor3 = SURFACE
    card.BorderSizePixel  = 0
    card.LayoutOrder      = idx
    card.Parent           = Scroll
    Instance.new("UICorner", card).CornerRadius = UDim.new(0, 10)
    local CardStroke = Instance.new("UIStroke", card)
    CardStroke.Color     = BORDER
    CardStroke.Thickness = 1

    local CardLayout = Instance.new("UIListLayout", card)
    CardLayout.SortOrder = Enum.SortOrder.LayoutOrder
    CardLayout.Padding   = UDim.new(0, 4)
    local CardPad = Instance.new("UIPadding", card)
    CardPad.PaddingLeft   = UDim.new(0, 12)
    CardPad.PaddingRight  = UDim.new(0, 12)
    CardPad.PaddingTop    = UDim.new(0, 10)
    CardPad.PaddingBottom = UDim.new(0, 10)

    -- Header: sea badge + age
    local HeaderRow = Instance.new("Frame")
    HeaderRow.Size                   = UDim2.new(1, 0, 0, 20)
    HeaderRow.BackgroundTransparency = 1
    HeaderRow.LayoutOrder            = 1
    HeaderRow.Parent                 = card

    local SeaBadge = Instance.new("TextLabel")
    SeaBadge.Size             = UDim2.new(0, 88, 1, 0)
    SeaBadge.BackgroundColor3 = Color3.fromRGB(30, 30, 50)
    SeaBadge.TextColor3       = seaCol
    SeaBadge.Font             = Enum.Font.GothamBold
    SeaBadge.TextSize         = 10
    SeaBadge.Text             = SEA_NAMES[sea] or "Sea " .. sea
    SeaBadge.BorderSizePixel  = 0
    SeaBadge.Parent           = HeaderRow
    Instance.new("UICorner", SeaBadge).CornerRadius = UDim.new(0, 5)

    local AgeLabel = Instance.new("TextLabel")
    AgeLabel.Size              = UDim2.new(1, -96, 1, 0)
    AgeLabel.Position          = UDim2.new(0, 94, 0, 0)
    AgeLabel.BackgroundTransparency = 1
    AgeLabel.TextColor3        = MUTED
    AgeLabel.Font              = Enum.Font.Gotham
    AgeLabel.TextSize          = 10
    AgeLabel.TextXAlignment    = Enum.TextXAlignment.Left
    AgeLabel.Text              = "Age: " .. fmtSec(srv.ageSeconds or 0)
    AgeLabel.Parent            = HeaderRow

    -- Players
    local PlayersLabel = Instance.new("TextLabel")
    PlayersLabel.Size              = UDim2.new(1, 0, 0, 16)
    PlayersLabel.BackgroundTransparency = 1
    PlayersLabel.TextColor3        = MUTED
    PlayersLabel.Font              = Enum.Font.Gotham
    PlayersLabel.TextSize          = 10
    PlayersLabel.TextXAlignment    = Enum.TextXAlignment.Left
    PlayersLabel.Text              = "👥 " .. (srv.playerCount or 0) .. " / " .. (srv.maxPlayers or 0) .. " players"
    PlayersLabel.LayoutOrder       = 2
    PlayersLabel.Parent            = card

    -- Events
    local events = srv.events or {}
    for _, ev in ipairs(events) do
        if ev.timeUntilSeconds == nil and not ev.isActive then continue end
        local evRow = Instance.new("Frame")
        evRow.Size             = UDim2.new(1, 0, 0, 22)
        evRow.BackgroundColor3 = ev.isActive and Color3.fromRGB(5, 46, 22)
            or ev.isAlert and Color3.fromRGB(69, 26, 3) or SURFACE2
        evRow.BorderSizePixel  = 0
        evRow.LayoutOrder      = 10
        evRow.Parent           = card
        Instance.new("UICorner", evRow).CornerRadius = UDim.new(0, 6)

        local icon = EVENT_ICONS[ev.key] or "●"
        local evCol = ev.isActive and ACTIVE_COLOR or ev.isAlert and ALERT_COLOR or MUTED

        local EvName = Instance.new("TextLabel")
        EvName.Size              = UDim2.new(0.62, 0, 1, 0)
        EvName.Position          = UDim2.new(0, 8, 0, 0)
        EvName.BackgroundTransparency = 1
        EvName.TextColor3        = evCol
        EvName.Font              = Enum.Font.Gotham
        EvName.TextSize          = 10
        EvName.TextXAlignment    = Enum.TextXAlignment.Left
        EvName.Text              = icon .. "  " .. (ev.name or ev.key)
        EvName.Parent            = evRow

        local timeText = ev.isActive and "⚡ ACTIVE"
            or (ev.isAlert and "⚠️ " or "") .. fmtSec(ev.timeUntilSeconds or 0)
        local EvTime = Instance.new("TextLabel")
        EvTime.Size              = UDim2.new(0.36, 0, 1, 0)
        EvTime.Position          = UDim2.new(0.64, 0, 0, 0)
        EvTime.BackgroundTransparency = 1
        EvTime.TextColor3        = evCol
        EvTime.Font              = Enum.Font.GothamSemibold
        EvTime.TextSize          = 10
        EvTime.TextXAlignment    = Enum.TextXAlignment.Right
        EvTime.Text              = timeText
        EvTime.Parent            = evRow
    end

    -- Next event summary line
    local nextEvSec = srv.nextEventSeconds
    if nextEvSec and nextEvSec < 9999999 then
        local summaryRow = Instance.new("Frame")
        summaryRow.Size             = UDim2.new(1, 0, 0, 18)
        summaryRow.BackgroundTransparency = 1
        summaryRow.LayoutOrder      = 9
        summaryRow.Parent           = card
        local summaryLbl = Instance.new("TextLabel")
        summaryLbl.Size              = UDim2.new(1, 0, 1, 0)
        summaryLbl.BackgroundTransparency = 1
        summaryLbl.TextColor3        = nextEvSec < 240 and ACTIVE_COLOR
            or nextEvSec < 600 and ALERT_COLOR or MUTED
        summaryLbl.Font              = Enum.Font.GothamSemibold
        summaryLbl.TextSize          = 10
        summaryLbl.TextXAlignment    = Enum.TextXAlignment.Left
        summaryLbl.Text              = "Next event: " .. fmtSec(nextEvSec)
        summaryLbl.Parent            = summaryRow
    end

    -- Teleport button
    local JoinBtn = Instance.new("TextButton")
    JoinBtn.Size             = UDim2.new(1, 0, 0, 30)
    JoinBtn.BackgroundColor3 = ACCENT
    JoinBtn.TextColor3       = Color3.fromRGB(255, 255, 255)
    JoinBtn.Font             = Enum.Font.GothamBold
    JoinBtn.TextSize         = 12
    JoinBtn.Text             = "⚓  Teleport → " .. (SEA_NAMES[sea] or "Sea")
    JoinBtn.BorderSizePixel  = 0
    JoinBtn.LayoutOrder      = 99
    JoinBtn.Parent           = card
    Instance.new("UICorner", JoinBtn).CornerRadius = UDim.new(0, 8)

    JoinBtn.MouseEnter:Connect(function()
        TweenService:Create(JoinBtn, TweenInfo.new(0.12), {BackgroundColor3 = ACCENT2}):Play()
    end)
    JoinBtn.MouseLeave:Connect(function()
        TweenService:Create(JoinBtn, TweenInfo.new(0.12), {BackgroundColor3 = ACCENT}):Play()
    end)

    JoinBtn.MouseButton1Click:Connect(function()
        if not JoinBtn.Active then return end
        JoinBtn.Active = false
        JoinBtn.Text             = "⏳ Checking server…"
        JoinBtn.BackgroundColor3 = ALERT_COLOR
        StatusLabel.Text         = "Verifying server is alive…"

        task.spawn(function()
            -- Step 1: verify the server is still alive on Roblox
            local alive, reason = checkServerAlive(jobId)

            if not alive then
                JoinBtn.Text             = "❌ Server closed — try another"
                JoinBtn.BackgroundColor3 = RED
                StatusLabel.Text         = "Server expired (reason: " .. tostring(reason) .. ")"
                task.wait(3)
                JoinBtn.Text             = "⚓  Teleport → " .. (SEA_NAMES[sea] or "Sea")
                JoinBtn.BackgroundColor3 = ACCENT
                JoinBtn.Active           = true
                return
            end

            -- Step 2: teleport
            JoinBtn.Text             = "🚀 Teleporting…"
            JoinBtn.BackgroundColor3 = ACTIVE_COLOR
            StatusLabel.Text         = "Teleporting to " .. (SEA_NAMES[sea] or "Sea") .. "…"

            local ok, err = pcall(function()
                -- placeId is already math.floor()'d to ensure it's a proper integer
                TeleportService:TeleportToPlaceInstance(placeId, jobId, LocalPlayer)
            end)

            if not ok then
                JoinBtn.Text             = "❌ Teleport failed — try another"
                JoinBtn.BackgroundColor3 = RED
                StatusLabel.Text         = "Teleport error: " .. tostring(err):sub(1, 80)
                task.wait(4)
                JoinBtn.Text             = "⚓  Teleport → " .. (SEA_NAMES[sea] or "Sea")
                JoinBtn.BackgroundColor3 = ACCENT
                JoinBtn.Active           = true
            end
            -- If ok, Roblox will kick us to the new server so no cleanup needed
        end)
    end)

    card.MouseEnter:Connect(function()
        TweenService:Create(CardStroke, TweenInfo.new(0.12), {Color = ACCENT}):Play()
    end)
    card.MouseLeave:Connect(function()
        TweenService:Create(CardStroke, TweenInfo.new(0.12), {Color = BORDER}):Play()
    end)

    return card
end

-- ─────────────────────────────────────────────
--  Render Cards
-- ─────────────────────────────────────────────
local function renderCards()
    for _, child in ipairs(Scroll:GetChildren()) do
        if child:IsA("Frame") and child.Name:sub(1, 5) == "Card_" then
            child:Destroy()
        end
        if child:IsA("TextLabel") then child:Destroy() end
    end

    local list = {}
    for _, srv in ipairs(serverData) do
        -- Compare as numbers — JSON decode gives Lua numbers
        if (srv.sea or 0) == selectedSea then
            table.insert(list, srv)
        end
    end

    -- Sort
    if sortMode == "event" then
        table.sort(list, function(a, b)
            return (a.nextEventSeconds or 9999999) < (b.nextEventSeconds or 9999999)
        end)
    elseif sortMode == "age" then
        table.sort(list, function(a, b)
            return (a.ageSeconds or 0) > (b.ageSeconds or 0)
        end)
    elseif sortMode == "players" then
        table.sort(list, function(a, b)
            return (a.playerCount or 0) > (b.playerCount or 0)
        end)
    end

    if #list == 0 then
        local Empty = Instance.new("TextLabel")
        Empty.Name              = "EmptyLabel"
        Empty.Size              = UDim2.new(1, 0, 0, 80)
        Empty.BackgroundTransparency = 1
        Empty.TextColor3        = MUTED
        Empty.Font              = Enum.Font.Gotham
        Empty.TextSize          = 12
        Empty.TextWrapped       = true
        Empty.Text              = "No servers found for " .. (SEA_NAMES[selectedSea] or "this sea") ..
            ".\n\nRefresh data or wait — server scans run every 10 min."
        Empty.LayoutOrder       = 1
        Empty.Parent            = Scroll
    end

    for i, srv in ipairs(list) do
        createCard(srv, i)
    end
    CountLabel.Text = #list .. " servers"
end

-- ─────────────────────────────────────────────
--  Tab + Sort Wiring
-- ─────────────────────────────────────────────
local function updateTabVisuals()
    for sea, btn in pairs(tabButtons) do
        local isSelected = sea == selectedSea
        btn.BackgroundColor3 = isSelected and SEA_COLORS[sea] or SURFACE
        btn.TextColor3       = isSelected and Color3.fromRGB(255,255,255) or MUTED
    end
end

local function updateSortVisuals()
    for mode, btn in pairs(sortBtns) do
        btn.BackgroundColor3 = mode == sortMode and ACCENT or SURFACE
        btn.TextColor3       = mode == sortMode and Color3.fromRGB(255,255,255) or MUTED
    end
end

for sea, btn in pairs(tabButtons) do
    btn.MouseButton1Click:Connect(function()
        selectedSea = sea
        updateTabVisuals()
        renderCards()
    end)
end

for mode, btn in pairs(sortBtns) do
    btn.MouseButton1Click:Connect(function()
        sortMode = mode
        updateSortVisuals()
        renderCards()
    end)
end

updateTabVisuals()
updateSortVisuals()

-- ─────────────────────────────────────────────
--  Fetch Servers from API
-- ─────────────────────────────────────────────
local function fetchServers()
    StatusDot.BackgroundColor3 = ALERT_COLOR
    StatusLabel.Text           = "Fetching servers…"

    local ok, result = pcall(function()
        -- Fetch all seas at once, filter client-side (max 500 servers)
        local url = safeUrl(API_URL, "/api/servers?limit=500")
        local raw = HttpService:GetAsync(url, true)
        return HttpService:JSONDecode(raw)
    end)

    if not ok then
        StatusDot.BackgroundColor3 = RED
        StatusLabel.Text = "❌ Can't reach API. Check API_URL."
        warn("[BloxHop] API error:", tostring(result))
        return
    end

    if type(result) ~= "table" then
        StatusLabel.Text = "❌ Bad API response"
        return
    end

    serverData = result
    StatusDot.BackgroundColor3 = ACTIVE_COLOR
    renderCards()
end

-- ─────────────────────────────────────────────
--  Auto-Refresh Every 30s
-- ─────────────────────────────────────────────
RunService.Heartbeat:Connect(function(dt)
    refreshTimer = refreshTimer + dt
    if refreshTimer >= REFRESH_INTERVAL then
        refreshTimer = 0
        task.spawn(fetchServers)
    end
    local remaining = math.ceil(REFRESH_INTERVAL - refreshTimer)
    if #serverData > 0 then
        local seaCount = 0
        for _, s in ipairs(serverData) do
            if (s.sea or 0) == selectedSea then seaCount += 1 end
        end
        StatusLabel.Text = "✅ " .. seaCount .. " " .. (SEA_NAMES[selectedSea] or "Sea") ..
            " servers  •  refresh in " .. remaining .. "s"
    end
end)

-- ─────────────────────────────────────────────
--  Initial Load
-- ─────────────────────────────────────────────
task.spawn(fetchServers)
print("[BloxHop] Loaded. API:", API_URL, "| Current sea:", currentSea)
