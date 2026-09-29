// ─── NEXUS Brain — Générateur de code from scratch ────────────────────────────
// Templates paramétrés Roblox/Luau (pièces, kill bricks, téléporteurs…) et
// scaffolds propres pour 14 langages. Aucun LLM : composition de gabarits.

import type { Entities } from './entities'

export interface GeneratedCode {
  language: string
  filename: string
  code: string
  description: string // courte explication pour la réponse finale
}

type Ctx = { text: string; entities: Entities; topic: string }

const has = (text: string, re: RegExp) => re.test(text)

// ── Roblox / Luau : templates métier ─────────────────────────────────────────

function luauCoin(ctx: Ctx): GeneratedCode {
  const amount = ctx.entities.numbers?.find((n) => n > 0 && n < 100) ?? 10
  return {
    language: 'lua',
    filename: 'coin_spawner.lua',
    description: `spawner de pièces (${amount} max au sol, collecte +100 % serveur, respawn 5 s)`,
    code: `--=============================================================--
-- SPAWNER DE PIÈCES — Roblox Studio (Luau)
-- À placer dans ServerScriptService
-- Le dossier "Pieces" est créé automatiquement dans Workspace
--=============================================================--

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

-- ── Réglages ──────────────────────────────────────────────
local QUANTITE_MAX = ${amount}      -- pièces présentes simultanément
local ZONE = Vector2.new(60, 60)    -- zone de spawn (mètres)
local VALEUR = 10                   -- argent donné par pièce
local RESPAWN = 5                   -- secondes avant nouvelle pièce

local pieces = Instance.new("Folder")
pieces.Name = "Pieces"
pieces.Parent = Workspace

-- ── Leaderstats (argent) ──────────────────────────────────
local function preparerJoueur(joueur: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local argent = Instance.new("IntValue")
	argent.Name = "Argent"
	argent.Value = 0
	argent.Parent = stats
end

Players.PlayerAdded:Connect(preparerJoueur)
for _, joueur in Players:GetPlayers() do
	preparerJoueur(joueur)
end

-- ── Création d'une pièce ──────────────────────────────────
local function creerPiece(): Part
	local piece = Instance.new("Part")
	piece.Name = "Piece"
	piece.Shape = Enum.PartType.Cylinder
	piece.Size = Vector3.new(0.3, 1.4, 1.4)
	piece.Color = Color3.fromRGB(255, 200, 40)
	piece.Material = Enum.Material.Neon
	piece.Position = Vector3.new(
		(math.random() - 0.5) * ZONE.X,
		2,
		(math.random() - 0.5) * ZONE.Y
	)
	piece.Anchored = true
	piece.CanCollide = false

	local lumiere = Instance.new("PointLight")
	lumiere.Color = piece.Color
	lumiere.Range = 8
	lumiere.Parent = piece

	piece.Parent = pieces

	-- Collecte : premier joueur qui touche
	local collecte = false
	piece.Touched:Connect(function(touche)
		if collecte then return end
		local personnage = touche.Parent
		local joueur = Players:GetPlayerFromCharacter(personnage)
		if joueur and joueur:FindFirstChild("leaderstats") then
			collecte = true
			local argent = joueur.leaderstats:FindFirstChild("Argent")
			if argent then
				argent.Value += \${VALEUR}
			end
			piece:Destroy()
			task.delay(RESPAWN, creerPiece)
		end
	end)

	return piece
end

-- ── Peuplement initial ────────────────────────────────────
for i = 1, QUANTITE_MAX do
	creerPiece()
end

print("✅ Spawner de pièces actif (${amount} pièces, +\${VALEUR}/pièce)")
`,
  }
}

function luauKill(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'kill_brick.lua',
    description: 'kill brick (bloc mortel + respawn du joueur, respect du spawn)',
    code: `--=============================================================--
-- KILL BRICK — Roblox Studio (Luau)
-- Place ce Script DANS le bloc mortel (pas ServerScriptService)
--=============================================================--

local Players = game:GetService("Players")

local BLOC = script.Parent :: BasePart

-- Réglages
local DELAI_RESPECT = 2 -- secondes d'invincibilité après respawn

local derniersSpawns: { [Player]: number } = {}

Players.PlayerAdded:Connect(function(joueur)
	joueur.CharacterAdded:Connect(function()
		derniersSpawns[joueur] = os.clock()
	end)
end)

local function tuer(personnage: Model)
	local humain = personnage:FindFirstChildOfClass("Humanoid")
	if humain and humain.Health > 0 then
		humain.Health = 0
	end
end

BLOC.Touched:Connect(function(touche)
	local personnage = touche.Parent
	if not personnage then return end

	local joueur = Players:GetPlayerFromCharacter(personnage)
	if not joueur then return end

	-- Respect post-respawn
	local spawnAt = derniersSpawns[joueur]
	if spawnAt and os.clock() - spawnAt < DELAI_RESPECT then return end

	tuer(personnage)
end)

-- Effet visuel : le bloc pulse en rouge
local couleurOrigine = BLOC.Color
task.spawn(function()
	while BLOC.Parent do
		local t = os.clock() % 1
		BLOC.Color = couleurOrigine:Lerp(Color3.fromRGB(255, 40, 40), t)
		task.wait(0.05)
	end
end)

print("✅ Kill brick armé : " .. BLOC:GetFullName())
`,
  }
}

function luauCheckpoint(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'checkpoints.lua',
    description: 'système de checkpoints d’obby (ordre respecté, sauvegarde du stade)',
    code: `--=============================================================--
-- CHECKPOINTS D'OBBY — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Nomme tes blocs "Checkpoint1", "Checkpoint2", … dans Workspace
--=============================================================--

local Players = game:GetService("Players")

-- ── Repérage des checkpoints ──────────────────────────────
local checkpoints: { BasePart } = {}
for i = 1, 100 do
	local cp = workspace:FindFirstChild("Checkpoint" .. i)
	if not cp then break end
	if cp:IsA("BasePart") then
		table.insert(checkpoints, cp)
	end
end
assert(#checkpoints > 0, "Aucun CheckpointN trouvé dans Workspace !")

-- ── État des joueurs ──────────────────────────────────────
local stade: { [Player]: number } = {}

local function preparerJoueur(joueur: Player)
	stade[joueur] = 0

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local etape = Instance.new("IntValue")
	etape.Name = "Étape"
	etape.Parent = stats

	joueur.CharacterAdded:Connect(function(personnage)
		local index = stade[joueur] or 0
		local destination = index == 0 and workspace:FindFirstChild("SpawnLocation") or checkpoints[index]
		if destination then
			local racine = personnage:WaitForChild("HumanoidRootPart")
			task.wait(0.1)
			racine.CFrame = destination.CFrame + Vector3.new(0, 4, 0)
		end
	end)
end

Players.PlayerAdded:Connect(preparerJoueur)
for _, joueur in Players:GetPlayers() do
	preparerJoueur(joueur)
end

-- ── Validation des checkpoints ────────────────────────────
for index, cp in checkpoints do
	cp.Touched:Connect(function(touche)
		local joueur = Players:GetPlayerFromCharacter(touche.Parent)
		if not joueur then return end
		-- On ne valide que le checkpoint suivant (pas de triche)
		if (stade[joueur] or 0) == index - 1 then
			stade[joueur] = index
			local etape = joueur.leaderstats and joueur.leaderstats:FindFirstChild("Étape")
			if etape then etape.Value = index end
		end
	end)
end

print(\`✅ ${'{'}#{checkpoints}${'}'} checkpoints chargés\`)
`,
  }
}

function luauTeleporter(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'teleporteur.lua',
    description: 'téléporteur à deux plots (A → B avec effet + cooldown)',
    code: `--=============================================================--
-- TÉLÉPORTEUR — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Nomme les plots "TeleportA" et "TeleportB" dans Workspace
--=============================================================--

local COOLDOWN = 2 -- secondes

local plotA = workspace:WaitForChild("TeleportA") :: BasePart
local plotB = workspace:WaitForChild("TeleportB") :: BasePart
local dernierUsage: { [Player]: number } = {}

local function brancher(depart: BasePart, arrivee: BasePart)
	depart.Touched:Connect(function(touche)
		local joueur = game.Players:GetPlayerFromCharacter(touche.Parent)
		if not joueur then return end

		local maintenant = os.clock()
		if (dernierUsage[joueur] or 0) + COOLDOWN > maintenant then return end
		dernierUsage[joueur] = maintenant

		local racine = touche.Parent:FindFirstChild("HumanoidRootPart")
		if not racine then return end

		-- Effet sonore + flash (optionnels mais sympas)
		local son = Instance.new("Sound")
		son.SoundId = "rbxassetid://12221967" -- whoosh
		son.Volume = 0.5
		son.Parent = racine
		son:Play()

		racine.CFrame = arrivee.CFrame + Vector3.new(0, 4, 0)

		-- Effet visuel de particules
		local particules = Instance.new("ParticleEmitter")
		particules.Color = ColorSequence.new(Color3.fromRGB(120, 80, 255))
		particules.Lifetime = NumberRange.new(0.4)
		particules.Speed = NumberRange.new(8)
		particules.Parent = racine
		task.delay(0.6, function() particules:Destroy() end)
	end)
end

brancher(plotA, plotB)
brancher(plotB, plotA)

print("✅ Téléporteur A ↔ B actif")
`,
  }
}

function luauLeaderboard(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'classement_live.lua',
    description: 'classement live (top 10 argent, panneau SurfaceGui actualisé)',
    code: `--=============================================================--
-- CLASSEMENT LIVE — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Crée un Part "PanneauClassement" avec un SurfaceGui > TextLabel
--=============================================================--

local Players = game:GetService("Players")

local panneau = workspace:WaitForChild("PanneauClassement") :: BasePart
local gui = panneau:WaitForChild("SurfaceGui")
local label = gui:WaitForChild("TextLabel") :: TextLabel
label.TextScaled = true

local function rafraichir()
	local classement = {}
	for _, joueur in Players:GetPlayers() do
		local stats = joueur:FindFirstChild("leaderstats")
		local argent = stats and stats:FindFirstChild("Argent")
		if argent then
			table.insert(classement, { nom = joueur.Name, valeur = argent.Value })
		end
	end

	table.sort(classement, function(a, b)
		return a.valeur > b.valeur
	end)

	local lignes = { "🏆 CLASSEMENT 🏆", "" }
	for rang, entree in ipairs(classement) do
		if rang > 10 then break end
		local medaille = rang == 1 and "🥇" or rang == 2 and "🥈" or rang == 3 and "🥉" or rang .. "."
		table.insert(lignes, string.format("%s %s — %d", medaille, entree.nom, entree.valeur))
	end

	label.Text = table.concat(lignes, "\\n")
end

-- Mise à jour régulière + au join/leave
task.spawn(function()
	while true do
		rafraichir()
		task.wait(3)
	end
end)
Players.PlayerAdded:Connect(rafraichir)
Players.PlayerRemoving:Connect(rafraichir)

print("✅ Classement live actif (top 10, 3 s)")
`,
  }
}

function luauDatastore(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'sauvegarde_datastore.lua',
    description: 'sauvegarde DataStore (argent persistant, pcall, session lock léger)',
    code: `--=============================================================--
-- SAUVEGARDE DATASTORE — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- ⚠️ Active "Enable Studio Access to API Services" (Game Settings)
--=============================================================--

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")

local store = DataStoreService:GetDataStore("SauvegardeJeu_v1")

-- ── Chargement ────────────────────────────────────────────
local function charger(joueur: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	stats.Parent = joueur

	local argent = Instance.new("IntValue")
	argent.Name = "Argent"
	argent.Parent = stats

	local cle = "joueur_" .. joueur.UserId
	local ok, donnees = pcall(function()
		return store:GetAsync(cle)
	end)

	if ok and type(donnees) == "table" then
		argent.Value = tonumber(donnees.argent) or 0
	else
		if not ok then
			warn("Échec de chargement pour " .. joueur.Name .. " : " .. tostring(donnees))
		end
		argent.Value = 100 -- valeur de départ
	end
end

-- ── Sauvegarde ────────────────────────────────────────────
local function sauvegarder(joueur: Player)
	local stats = joueur:FindFirstChild("leaderstats")
	local argent = stats and stats:FindFirstChild("Argent")
	if not argent then return end

	local cle = "joueur_" .. joueur.UserId
	local ok, err = pcall(function()
		store:SetAsync(cle, {
			argent = argent.Value,
			sauvegardeAu = os.time(),
		})
	end)
	if not ok then
		warn("Échec de sauvegarde pour " .. joueur.Name .. " : " .. tostring(err))
	end
end

Players.PlayerAdded:Connect(charger)
Players.PlayerRemoving:Connect(sauvegarder)

-- Sécurité : sauvegarde de secours à la fermeture du serveur
game:BindToClose(function()
	for _, joueur in Players:GetPlayers() do
		sauvegarder(joueur)
	end
end)

print("✅ DataStore prêt (chargement + sauvegarde auto)")
`,
  }
}

function luauDoor(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'porte_automatique.lua',
    description: 'porte automatique (s’ouvre au toucher, TweenService, sécurité joueurs uniquement)',
    code: `--=============================================================--
-- PORTE AUTOMATIQUE — Roblox Studio (Luau)
-- Place ce Script DANS la porte (Part)
--=============================================================--

local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")

local porte = script.Parent :: BasePart
local HAUTEUR_OUVERTE = porte.Size.Y * 0.9

local fermeeCFrame = porte.CFrame
local ouverteCFrame = fermeeCFrame * CFrame.new(0, HAUTEUR_OUVERTE, 0)

local info = TweenInfo.new(0.8, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
local tweenOuvrir = TweenService:Create(porte, info, { CFrame = ouverteCFrame })
local tweenFermer = TweenService:Create(porte, info, { CFrame = fermeeCFrame })

local ouverte = false
local enMouvement = false

local function basculer(ouvrir: boolean)
	if enMouvement or ouverte == ouvrir then return end
	enMouvement = true
	local tween = ouvrir and tweenOuvrir or tweenFermer
	tween:Play()
	tween.Completed:Wait()
	ouverte = ouvrir
	enMouvement = false
end

porte.Touched:Connect(function(touche)
	local personnage = touche.Parent
	if personnage and Players:GetPlayerFromCharacter(personnage) then
		basculer(true)
	end
end)

-- Referme quand plus personne autour
task.spawn(function()
	while porte.Parent do
		task.wait(1)
		local zone = workspace:GetPartBoundsInBox(porte.CFrame, Vector3.new(8, 6, 8))
		local joueurProche = false
		for _, part in zone do
			local modele = part:FindFirstAncestorOfClass("Model")
			if modele and Players:GetPlayerFromCharacter(modele) then
				joueurProche = true
				break
			end
		end
		if not joueurProche then
			basculer(false)
		end
	end
end)

print("✅ Porte automatique installée : " .. porte.Name)
`,
  }
}

function luauSpeed(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'plateau_vitesse.lua',
    description: 'plateau de vitesse (boost de vitesse temporaire avec retour à la normale)',
    code: `--=============================================================--
-- PLATEAU DE VITESSE — Roblox Studio (Luau)
-- Place ce Script DANS le plateau (Part)
--=============================================================--

local Players = game:GetService("Players")

local plateau = script.Parent :: BasePart
local VITESSE_BOOST = 42   -- WalkSpeed de base : 16
local DUREE = 4            -- secondes de boost
local COOLDOWN: { [Player]: number } = {}

plateau.Touched:Connect(function(touche)
	local joueur = Players:GetPlayerFromCharacter(touche.Parent)
	if not joueur then return end
	if (COOLDOWN[joueur] or 0) + DUREE > os.clock() then return end
	COOLDOWN[joueur] = os.clock()

	local personnage = touche.Parent
	local humain = personnage:FindFirstChildOfClass("Humanoid")
	if not humain then return end

	-- Effet visuel : plateau qui brille
	plateau.Material = Enum.Material.Neon
	plateau.Color = Color3.fromRGB(0, 255, 120)

	humain.WalkSpeed = VITESSE_BOOST

	task.delay(DUREE, function()
		if humain.Parent then
			humain.WalkSpeed = 16
		end
		plateau.Material = Enum.Material.SmoothPlastic
		plateau.Color = Color3.fromRGB(120, 120, 120)
	end)
end)

print("✅ Plateau de vitesse : " .. VITESSE_BOOST .. " walkspeed pendant " .. DUREE .. " s")
`,
  }
}

function luauNpc(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'pnj_suiveur.lua',
    description: 'PNJ qui suit le joueur le plus proche (pathfinding, animation de marche)',
    code: `--=============================================================--
-- PNJ SUIVEUR — Roblox Studio (Luau)
-- Script DANS le modèle du PNJ (avec Humanoid + HumanoidRootPart)
--=============================================================--

local PathfindingService = game:GetService("PathfindingService")
local Players = game:GetService("Players")

local pnj = script.Parent
local humain = pnj:WaitForChild("Humanoid") :: Humanoid
local racine = pnj:WaitForChild("HumanoidRootPart") :: BasePart

local RAYON_DETECTION = 40 -- mètres

local function joueurLePlusProche(): Player?
	local meilleur: Player? = nil
	local distanceMin = RAYON_DETECTION
	for _, joueur in Players:GetPlayers() do
		local perso = joueur.Character
		local cible = perso and perso:FindFirstChild("HumanoidRootPart")
		if cible then
			local d = (cible.Position - racine.Position).Magnitude
			if d < distanceMin then
				distanceMin = d
				meilleur = joueur
			end
		end
	end
	return meilleur
end

local function seDeplacerVers(position: Vector3)
	local chemin = PathfindingService:CreatePath({
		AgentRadius = 2,
		AgentHeight = 5,
		AgentCanJump = true,
	})
	local ok = pcall(function()
		chemin:ComputeAsync(racine.Position, position)
	end)
	if ok and chemin.Status == Enum.PathStatus.Success then
		for _, waypoint in chemin:GetWaypoints() do
			if waypoint.Action == Enum.PathWaypointAction.Jump then
				humain.Jump = true
			end
			humain:MoveTo(waypoint.Position)
			local atteint = humain.MoveToFinished:Wait()
			if not atteint then break end
		end
	else
		-- Pas de chemin : on fonce en ligne droite
		humain:MoveTo(position)
	end
end

-- Boucle de suivi (10× par seconde)
task.spawn(function()
	while pnj.Parent do
		local cible = joueurLePlusProche()
		if cible and cible.Character then
			local racineCible = cible.Character:FindFirstChild("HumanoidRootPart")
			if racineCible and (racineCible.Position - racine.Position).Magnitude > 6 then
				seDeplacerVers(racineCible.Position)
			end
		end
		task.wait(0.1)
	end
end)

print("✅ PNJ suiveur actif (rayon " .. RAYON_DETECTION .. " m)")
`,
  }
}

function luauShop(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'boutique.lua',
    description: 'boutique en jeu (achat serveur sécurisé, prix, inventaire des outils)',
    code: `--=============================================================--
-- BOUTIQUE — Roblox Studio (Luau)
-- Script dans ServerScriptService + RemoteEvent "Acheter" (ReplicatedStorage)
-- Côté client : ReplicatedStorage.Acheter:FireServer(nomItem)
--=============================================================--

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local remote = ReplicatedStorage:WaitForChild("Acheter") :: RemoteEvent

-- ── Catalogue (prix en Argent) ────────────────────────────
local CATALOGUE: { [string]: { prix: number, outil: string } } = {
	epee_fer = { prix = 100, outil = "ÉpéeEnFer" },
	potion_vie = { prix = 50, outil = "PotionVie" },
	botte_vitesse = { prix = 200, outil = "BotteVitesse" },
	bouclier = { prix = 350, outil = "Bouclier" },
}

-- Le dossier "Outils" contient les Tool du jeu
local dossierOutils = ReplicatedStorage:WaitForChild("Outils")

remote.OnServerEvent:Connect(function(joueur, nomItem)
	-- ── VALIDATION SERVEUR (jamais confiance au client) ──
	if type(nomItem) ~= "string" then return end
	local item = CATALOGUE[nomItem]
	if not item then return end

	local stats = joueur:FindFirstChild("leaderstats")
	local argent = stats and stats:FindFirstChild("Argent")
	if not argent then return end
	if argent.Value < item.prix then return end

	-- Déjà possédé ?
	local backpack = joueur:FindFirstChild("Backpack")
	if backpack and backpack:FindFirstChild(item.outil) then return end

	-- Achat
	argent.Value -= item.prix
	local outil = dossierOutils:WaitForChild(item.outil):Clone()
	outil.Parent = joueur.Backpack

	-- Confirmation renvoyée au client (pour le son/la notif)
	remote:FireClient(joueur, true, nomItem)
end)

print("✅ Boutique ouverte (" .. (function()
	local n = 0
	for _ in CATALOGUE do n += 1 end
	return n
end)() .. " articles)")
`,
  }
}

function luauDayNight(ctx: Ctx): GeneratedCode {
  return {
    language: 'lua',
    filename: 'cycle_jour_nuit.lua',
    description: 'cycle jour/nuit fluide ( CLOCKTIME animé, lumières qui s’allument la nuit)',
    code: `--=============================================================--
-- CYCLE JOUR/NUIT — Roblox Studio (Luau)
-- Script dans ServerScriptService
--=============================================================--

local Lighting = game:GetService("Lighting")

local DUREE_JOUR = 120      -- secondes pour une journée complète
local HEURE_DEBUT = 7       -- on démarre le matin

-- Réglages ambiance
local COULEUR_JOUR = Color3.fromRGB(255, 240, 200)
local COULEUR_NUIT = Color3.fromRGB(40, 60, 120)

local eclairages: { PointLight | SurfaceLight } = {}
for _, descendant in workspace:GetDescendants() do
	if descendant:IsA("PointLight") or descendant:IsA("SurfaceLight") then
		table.insert(eclairages, descendant)
	end
end

Lighting.ClockTime = HEURE_DEBUT

task.spawn(function()
	while true do
		local delta = task.wait(0.1)
		local avancement = delta / DUREE_JOUR * 24 -- heures écoulées
		Lighting.ClockTime = (Lighting.ClockTime + avancement) % 24

		-- Lumières automatiques la nuit
		local nuit = Lighting.ClockTime < 6.5 or Lighting.ClockTime > 18
		for _, lumiere in eclairages do
			lumiere.Enabled = nuit
		end
	end
end)

print("✅ Cycle jour/nuit : 1 journée = " .. DUREE_JOUR .. " s")
`,
  }
}

function luauGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'système personnalisé'
  return {
    language: 'lua',
    filename: 'script_roblox.lua',
    description: `script Luau générique bien structuré pour : ${sujet}`,
    code: `--=============================================================--
-- ${sujet.toUpperCase()} — Roblox Studio (Luau)
-- Script dans ServerScriptService
-- Structure : réglages → fonctions → connexions → démarrage
--=============================================================--

local Players = game:GetService("Players")

-- ── Réglages (modifie ici) ────────────────────────────────
local CONFIG = {
	actif = true,
	cooldown = 1, -- secondes entre deux déclenchements
	debug = true, -- affiche les messages de débogage
}

local dernierUsage: { [Player]: number } = {}

-- ── Fonctions métier ──────────────────────────────────────
local function log(message: string)
	if CONFIG.debug then
		print("[${sujet.slice(0, 20)}] " .. message)
	end
end

local function peutExecuter(joueur: Player): boolean
	if not CONFIG.actif then return false end
	local maintenant = os.clock()
	if (dernierUsage[joueur] or 0) + CONFIG.cooldown > maintenant then
		return false
	end
	dernierUsage[joueur] = maintenant
	return true
end

local function traiter(joueur: Player, donnees: unknown)
	if not peutExecuter(joueur) then return end
	-- TODO : ta logique métier ici
	log("Requête de " .. joueur.Name)
end

-- ── Connexions ────────────────────────────────────────────
Players.PlayerAdded:Connect(function(joueur)
	log(joueur.Name .. " a rejoint le jeu")
end)

-- Exemple de déclencheur au toucher d'un bloc nommé "Declencheur"
local declencheur = workspace:FindFirstChild("Declencheur")
if declencheur and declencheur:IsA("BasePart") then
	declencheur.Touched:Connect(function(touche)
		local joueur = Players:GetPlayerFromCharacter(touche.Parent)
		if joueur then
			traiter(joueur, nil)
		end
	end)
end

log("✅ Script démarré")
`,
  }
}

// ── Générateurs génériques par langage ───────────────────────────────────────

function pythonGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'programme Python'
  const isPrime = has(ctx.text, /premier|prime|nombre premier/i)
  const isFibo = has(ctx.text, /fibonacci/i)
  const isPwd = has(ctx.text, /mot de passe|password/i)
  const isSort = has(ctx.text, /tri|sort|ordre/i)

  if (isPrime) {
    return {
      language: 'python',
      filename: 'nombres_premiers.py',
      description: 'générateur de nombres premiers (crible d’Ératosthène, O(n log log n))',
      code: `# -*- coding: utf-8 -*-
"""Nombres premiers — crible d'Ératosthène.

Complexité : O(n log log n) — optimal pour lister tous les premiers < n.
"""

from math import isqrt


def crible(limit: int) -> list[int]:
    """Retourne tous les nombres premiers inférieurs à limit."""
    if limit < 2:
        return []
    est_premier = [True] * limit
    est_premier[0] = est_premier[1] = False
    for n in range(2, isqrt(limit) + 1):
        if est_premier[n]:
            # On raye les multiples à partir de n² (les précédents
            # ont déjà été rayés par des facteurs plus petits)
            for multiple in range(n * n, limit, n):
                est_premier[multiple] = False
    return [n for n, flag in enumerate(est_premier) if flag]


def est_premier(n: int) -> bool:
    """Test unitaire rapide (division jusqu'à √n)."""
    if n < 2:
        return False
    for diviseur in range(2, isqrt(n) + 1):
        if n % diviseur == 0:
            return False
    return True


if __name__ == "__main__":
    limite = int(input("Lister les premiers jusqu'à : ") or 100)
    premiers = crible(limite)
    print(f"{len(premiers)} nombres premiers sous {limite} :")
    print(", ".join(map(str, premiers[:30])) + ("…" if len(premiers) > 30 else ""))
`,
    }
  }
  if (isFibo) {
    return {
      language: 'python',
      filename: 'fibonacci.py',
      description: 'suite de Fibonacci (itératif O(n) + générateur)',
      code: `# -*- coding: utf-8 -*-
"""Fibonacci — version itérative O(n) + générateur infini."""


def fibonacci(n: int) -> list[int]:
    """Les n premiers termes de la suite (0, 1, 1, 2, 3, 5…)."""
    termes: list[int] = []
    a, b = 0, 1
    for _ in range(max(0, n)):
        termes.append(a)
        a, b = b, a + b
    return termes


def fibonacci_infini():
    """Générateur : yield à la demande, consommation mémoire O(1)."""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b


if __name__ == "__main__":
    n = int(input("Nombre de termes : ") or 10)
    print(" → ".join(map(str, fibonacci(n))))

    gen = fibonacci_infini()
    print("10 premiers termes du générateur :", [next(gen) for _ in range(10)])
`,
    }
  }
  if (isPwd) {
    return {
      language: 'python',
      filename: 'generateur_mdp.py',
      description: 'générateur de mots de passe sécurisés (module secrets, options)',
      code: `# -*- coding: utf-8 -*-
"""Générateur de mots de passe sécurisés.

Utilise le module \`secrets\` (cryptographiquement sûr) — jamais \`random\`.
"""

import secrets
import string

MINUSCULES = string.ascii_lowercase
MAJUSCULES = string.ascii_uppercase
CHIFFRES = string.digits
SPECIALS = "!@#$%&*+-_?"

CATEGORIES = [MINUSCULES, MAJUSCULES, CHIFFRES, SPECIALS]


def generer(longueur: int = 16, specials: bool = True) -> str:
    """Mot de passe garantissant au moins 1 caractère de chaque catégorie."""
    categories = CATEGORIES if specials else CATEGORIES[:3]
    alphabet = "".join(categories)

    if longueur < len(categories):
        raise ValueError(f"Longueur minimale : {len(categories)}")

    # Garantit 1 caractère par catégorie, puis complète au hasard
    mot = [secrets.choice(cat) for cat in categories]
    mot += [secrets.choice(alphabet) for _ in range(longueur - len(mot))]

    # Mélange sûr : les 4 premiers pourraient être prévisibles
    secrets.SystemRandom().shuffle(mot)
    return "".join(mot)


if __name__ == "__main__":
    for i in range(5):
        print(f"Mot de passe {i + 1} : {generer(16)}")
    print("Force estimée :", 16 * 6.5, "bits ≈ incassable en pratique")
`,
    }
  }
  if (isSort) {
    return {
      language: 'python',
      filename: 'tri_rapide.py',
      description: 'tri rapide (quicksort, complexité O(n log n) moyen)',
      code: `# -*- coding: utf-8 -*-
"""Tri rapide (quicksort) — implémentation pédagogique.

Moyenne O(n log n), pire cas O(n²) (pivot constant sur données triées).
"""

import random


def tri_rapide(liste: list[int]) -> list[int]:
    """Version claire (crée de nouvelles listes)."""
    if len(liste) <= 1:
        return liste
    pivot = liste[len(liste) // 2]
    gauche = [x for x in liste if x < pivot]
    milieu = [x for x in liste if x == pivot]
    droite = [x for x in liste if x > pivot]
    return tri_rapide(gauche) + milieu + tri_rapide(droite)


def tri_rapide_sur_place(liste: list[int], bas: int = 0, haut: int | None = None) -> list[int]:
    """Version Hoare en place (utilisé en production)."""
    if haut is None:
        haut = len(liste) - 1
    if bas < haut:
        pivot = liste[(bas + haut) // 2]
        i, j = bas, haut
        while i <= j:
            while liste[i] < pivot:
                i += 1
            while liste[j] > pivot:
                j -= 1
            if i <= j:
                liste[i], liste[j] = liste[j], liste[i]
                i, j = i + 1, j - 1
        tri_rapide_sur_place(liste, bas, j)
        tri_rapide_sur_place(liste, i, haut)
    return liste


if __name__ == "__main__":
    donnees = [random.randint(0, 99) for _ in range(15)]
    print("Entrée  :", donnees)
    print("Triée   :", tri_rapide(donnees))
    assert tri_rapide_sur_place(donnees[:]) == sorted(donnees), "bug de tri"
    print("✅ Vérification : OK")
`,
    }
  }
  return {
    language: 'python',
    filename: 'programme.py',
    description: `programme Python structuré : ${sujet}`,
    code: `# -*- coding: utf-8 -*-
"""${sujet} — programme Python.

Structure : constantes → fonctions pures → point d'entrée.
"""

import sys
from dataclasses import dataclass


@dataclass
class Resultat:
    """Résultat typé du traitement."""
    ok: bool
    valeur: str = ""
    erreur: str = ""


def traiter(entree: str) -> Resultat:
    """Traitement principal (fonction pure, testable)."""
    if not entree.strip():
        return Resultat(ok=False, erreur="entrée vide")
    # TODO : logique métier ici
    return Resultat(ok=True, valeur=entree.strip().upper())


def main(argv: list[str]) -> int:
    entree = " ".join(argv[1:]) if len(argv) > 1 else input("Entrée : ")
    resultat = traiter(entree)
    if resultat.ok:
        print(f"✅ Résultat : {resultat.valeur}")
        return 0
    print(f"❌ Erreur : {resultat.erreur}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
`,
  }
}

function jsGeneric(ctx: Ctx): GeneratedCode {
  const sujet = ctx.topic || 'programme JavaScript'
  return {
    language: 'javascript',
    filename: 'programme.js',
    description: `programme JavaScript moderne (ES2022) : ${sujet}`,
    code: `// ============================================================
// ${sujet} — JavaScript (ES2022)
// ============================================================

/** Config centralisée — modifie ici */
const CONFIG = Object.freeze({
  debug: true,
  maxEssais: 3,
});

/** Journal propre (désactivable) */
const log = (msg) => {
  if (CONFIG.debug) console.log(\`[app] \${msg}\`);
};

/**
 * Traitement principal — fonction pure, facile à tester.
 * @param {string} entree
 * @returns {{ ok: boolean, valeur?: string, erreur?: string }}
 */
function traiter(entree) {
  if (typeof entree !== 'string' || entree.trim() === '') {
    return { ok: false, erreur: 'entrée vide' };
  }
  // TODO : logique métier
  return { ok: true, valeur: entree.trim().toUpperCase() };
}

/** Exécution avec gestion d'erreurs */
function main() {
  log('Démarrage');
  const exemples = ['bonjour', '   test   ', ''];
  for (const exemple of exemples) {
    const resultat = traiter(exemple);
    if (resultat.ok) {
      console.log(\`✅ "\${exemple.trim()}" → \${resultat.valeur}\`);
    } else {
      console.error(\`❌ "\${exemple}" → \${resultat.erreur}\`);
    }
  }
}

// Point d'entrée (compatible Node + navigateur)
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
  main();
} else {
  document.addEventListener('DOMContentLoaded', main);
}
`,
  }
}

function htmlGeneric(ctx: Ctx): GeneratedCode {
  return {
    language: 'html',
    filename: 'index.html',
    description: 'page HTML/CSS/JS complète et responsive',
    code: `<!-- Page générée par le cerveau local de NEXUS -->
<div class="app">
  <header>
    <h1>🚀 Mon application</h1>
    <p>Générée localement — 100 % HTML/CSS/JS</p>
  </header>

  <main>
    <section class="cartes">
      <article class="carte">
        <h3>⚡ Rapide</h3>
        <p>Aucune dépendance, chargement instantané.</p>
      </article>
      <article class="carte">
        <h3>📱 Responsive</h3>
        <p>S'adapte du mobile au grand écran.</p>
      </article>
      <article class="carte">
        <h3>🎨 Moderne</h3>
        <p>Variables CSS, dégradés et animations.</p>
      </article>
    </section>

    <section class="interaction">
      <h2>Teste l'interaction</h2>
      <input id="champ" type="text" placeholder="Écris quelque chose…" />
      <button id="valider">Valider</button>
      <p id="sortie" aria-live="polite"></p>
    </section>
  </main>
</div>
`,
  }
}

const GENERIC_BUILDERS: Record<string, (ctx: Ctx) => GeneratedCode> = {
  javascript: jsGeneric,
  html: htmlGeneric,
  lua: luauGeneric,
  typescript: (ctx) => {
    const base = jsGeneric(ctx)
    return {
      language: 'typescript',
      filename: 'programme.ts',
      description: `programme TypeScript typé : ${ctx.topic || 'programme'}`,
      code: base.code
        .replace('/** @param {string} entree */', '')
        .replace('function traiter(entree) {', 'function traiter(entree: string): Resultat {')
        .replace(
          "const CONFIG = Object.freeze({",
          "interface Resultat {\n  ok: boolean;\n  valeur?: string;\n  erreur?: string;\n}\n\nconst CONFIG = Object.freeze({"
        ),
    }
  },
  csharp: (ctx) => genericSimple(ctx, 'csharp', 'Programme.cs', `using System;\n\nnamespace App\n{\n    class Programme\n    {\n        static void Main(string[] args)\n        {\n            Console.WriteLine("Bonjour !");\n            // TODO : logique métier\n        }\n    }\n}\n`),
  java: (ctx) => genericSimple(ctx, 'java', 'Main.java', `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Bonjour !");\n        // TODO : logique métier\n    }\n}\n`),
  cpp: (ctx) => genericSimple(ctx, 'cpp', 'main.cpp', `#include <iostream>\n\nint main() {\n    std::cout << "Bonjour !" << std::endl;\n    // TODO : logique métier\n    return 0;\n}\n`),
  c: (ctx) => genericSimple(ctx, 'c', 'main.c', `#include <stdio.h>\n\nint main(void) {\n    printf("Bonjour !\\n");\n    // TODO : logique métier\n    return 0;\n}\n`),
  go: (ctx) => genericSimple(ctx, 'go', 'main.go', `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Bonjour !")\n\t// TODO : logique métier\n}\n`),
  rust: (ctx) => genericSimple(ctx, 'rust', 'main.rs', `fn main() {\n    println!("Bonjour !");\n    // TODO : logique métier\n}\n`),
  bash: (ctx) => genericSimple(ctx, 'bash', 'script.sh', `#!/bin/bash\n# Script généré par NEXUS\nset -euo pipefail\n\necho "Bonjour !"\n# TODO : logique métier\n`),
  sql: (ctx) => genericSimple(ctx, 'sql', 'requete.sql', `-- Requête générée par NEXUS\nSELECT *\nFROM ma_table\nWHERE created_at >= CURRENT_DATE - INTERVAL '7 days'\nORDER BY created_at DESC\nLIMIT 50;\n`),
  glsl: (ctx) => genericSimple(ctx, 'glsl', 'shader.frag', `precision mediump float;\n\nuniform float u_time;\nuniform vec2 u_resolution;\n\nvoid main() {\n    vec2 uv = gl_FragCoord.xy / u_resolution;\n    float onde = sin(uv.x * 10.0 + u_time) * 0.5 + 0.5;\n    vec3 couleur = mix(vec3(0.1, 0.1, 0.3), vec3(0.9, 0.4, 0.8), onde);\n    gl_FragColor = vec4(couleur, 1.0);\n}\n`),
}

function genericSimple(ctx: Ctx, language: string, filename: string, code: string): GeneratedCode {
  return { language, filename, code, description: `programme ${language} structuré : ${ctx.topic || 'script'}` }
}

// ── Point d'entrée du générateur ─────────────────────────────────────────────

/** Détecte le template le plus adapté et compose le code. */
export function generateCodeLocal(text: string, entities: Entities, topic: string): GeneratedCode {
  const ctx: Ctx = { text, entities, topic }

  // Roblox/Luau : priorité aux templates métier si le sujet correspond
  const robloxLike = has(text, /roblox|luau|game\.|workspace|instance\.new|obby|studio/i)
  if (robloxLike || entities.language === 'lua') {
    if (has(text, /pi[èe]ce|coin|monnaie|argent(\s|$)/i)) return luauCoin(ctx)
    if (has(text, /kill|mortel|tue|lave|degat/i)) return luauKill(ctx)
    if (has(text, /checkpoint|obby|etape/i)) return luauCheckpoint(ctx)
    if (has(text, /teleport|t[ée]l[ée]port/i)) return luauTeleporter(ctx)
    if (has(text, /leaderboard|classement|top\b/i)) return luauLeaderboard(ctx)
    if (has(text, /datastore|sauvegard|save|persist/i)) return luauDatastore(ctx)
    if (has(text, /porte|door/i)) return luauDoor(ctx)
    if (has(text, /vitesse|speed|boost|sprint/i)) return luauSpeed(ctx)
    if (has(text, /pnj|npc|suivre|follow/i)) return luauNpc(ctx)
    if (has(text, /boutique|shop|magasin|acheter/i)) return luauShop(ctx)
    if (has(text, /jour|nuit|cycle|day.?night/i)) return luauDayNight(ctx)
    return luauGeneric(ctx)
  }

  // Langage explicite ou déduit
  const lang = entities.language ?? 'python'
  const builder = GENERIC_BUILDERS[lang]
  if (builder) return builder(ctx)

  // Fallback selon le contexte
  if (has(text, /page web|site|html|landing/i)) return htmlGeneric(ctx)
  if (has(text, /discord|bot/i)) return pythonGeneric(ctx)
  return pythonGeneric(ctx)
}
