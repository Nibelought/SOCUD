"use client";

import { useState, useEffect } from "react";
import { X, Search, ShieldAlert, Trash2, Archive, Loader2, RefreshCw, Save } from "lucide-react";

interface AccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    entityId: string;
    entityType: 'space' | 'document';
    currentUserId: string;
    onDeleteSuccess: () => void;
}

interface Member {
    id?: string;
    userId: string;
    role: 'OWNER' | 'EDITOR' | 'VIEWER';
    user: { id: string; email: string };
    source?: 'direct' | 'inherited'; // ← Новое поле
}

export default function AccessManagerModal({ isOpen, onClose, entityId, entityType, currentUserId, onDeleteSuccess }: AccessModalProps) {
    // Метаданные
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [isArchived, setIsArchived] = useState(false);

    // Участники и UI состояния
    const [members, setMembers] = useState<Member[]>([]);
    const [searchEmail, setSearchEmail] = useState("");
    const [searchResults, setSearchResults] = useState<{id: string, email: string}[]>([]);

    const [loadingData, setLoadingData] = useState(true);
    const [actionLoading, setActionLoading] = useState<'archive' | 'restore' | 'delete' | 'save' | null>(null);

    const baseUrl = `http://localhost:3000/${entityType}/${entityId}`;

    useEffect(() => {
        if (!isOpen) return;
        setLoadingData(true);
        const token = localStorage.getItem("socud_token");

        // Параллельная загрузка метаданных и участников
        Promise.all([
            fetch(baseUrl, { headers: { "Authorization": `Bearer ${token}` } }).then(res => res.json()),
            fetch(`${baseUrl}/members`, { headers: { "Authorization": `Bearer ${token}` } }).then(res => res.json())
        ]).then(([entityData, membersData]) => {
            setTitle(entityData.title || entityData.name || "");
            if (entityType === 'space') setDescription(entityData.description || "");
            setIsArchived(entityData.isArchived || false);

            if (Array.isArray(membersData)) setMembers(membersData);
        }).catch(err => console.error("Error fetching modal data", err))
            .finally(() => setLoadingData(false));
    }, [isOpen, baseUrl, entityType]);

    // Поиск пользователей с debounce
    useEffect(() => {
        if (searchEmail.length < 3) {
            setSearchResults([]);
            return;
        }
        const delay = setTimeout(async () => {
            const token = localStorage.getItem("socud_token");
            const res = await fetch(`http://localhost:3000/auth/users/search?email=${searchEmail}`, {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) setSearchResults(await res.json());
        }, 400);
        return () => clearTimeout(delay);
    },[searchEmail]);

    // Сохранение метаданных (Название и Описание)
    const handleSaveMetadata = async () => {
        setActionLoading('save');
        const token = localStorage.getItem("socud_token");

        const payload: any = entityType === 'space'
            ? { title, description } // space.service.ts сам преобразует title → name
            : { title };             // document.service.ts ожидает title

        const res = await fetch(baseUrl, {
            method: 'PATCH',
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        setActionLoading(null);
        if (!res.ok) alert("Failed to save changes. Check permissions.");
    };

    const handleUpdateRole = async (userId: string, role: string) => {
        const token = localStorage.getItem("socud_token");
        await fetch(`${baseUrl}/members`, {
            method: 'POST',
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ userId, role })
        });

        setMembers(prev => {
            const exists = prev.find(m => m.userId === userId);
            if (exists) return prev.map(m => m.userId === userId ? { ...m, role: role as any } : m);
            return[...prev, { userId, role: role as any, user: searchResults.find(u => u.id === userId)! }];
        });
        setSearchEmail("");
    };

    const handleRemoveMember = async (userId: string) => {
        const token = localStorage.getItem("socud_token");
        await fetch(`${baseUrl}/members/${userId}`, {
            method: 'DELETE',
            headers: { "Authorization": `Bearer ${token}` }
        });
        setMembers(prev => prev.filter(m => m.userId !== userId));
    };

    const handleArchiveEntity = async () => {
        if (!confirm(`Archive this ${entityType}? It will be hidden from viewers.`)) return;
        setActionLoading('archive');
        const token = localStorage.getItem("socud_token");
        const res = await fetch(`${baseUrl}/archive`, { method: 'POST', headers: { "Authorization": `Bearer ${token}` } });
        setActionLoading(null);
        if (res.ok) {
            setIsArchived(true);
            onDeleteSuccess(); // Редирект или обновление UI
        } else alert("Failed to archive. Requires OWNER permissions.");
    };

    const handleRestoreEntity = async () => {
        setActionLoading('restore');
        const token = localStorage.getItem("socud_token");
        const res = await fetch(`${baseUrl}/restore`, { method: 'POST', headers: { "Authorization": `Bearer ${token}` } });
        setActionLoading(null);
        if (res.ok) {
            setIsArchived(false);
            onDeleteSuccess(); // Редирект или обновление UI
        } else alert("Failed to restore. Requires OWNER permissions.");
    };

    const handleDeleteEntity = async () => {
        if (!confirm(`PERMANENTLY delete this ${entityType}? This action cannot be undone.`)) return;
        setActionLoading('delete');
        const token = localStorage.getItem("socud_token");
        const res = await fetch(baseUrl, { method: 'DELETE', headers: { "Authorization": `Bearer ${token}` } });
        setActionLoading(null);
        if (res.ok) {
            onClose();
            onDeleteSuccess();
        } else alert("Failed to delete. Requires OWNER permissions.");
    };

    if (!isOpen) return null;

    const ownersCount = members.filter(m => m.role === 'OWNER').length;
    const isCurrentUserOwner = members.find(m => m.userId === currentUserId)?.role === 'OWNER';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4">
            <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-800 capitalize">{entityType} Settings</h2>
                        {isArchived && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Archived</span>}
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>

                {loadingData ? (
                    <div className="flex justify-center items-center p-12 text-blue-600"><Loader2 className="w-8 h-8 animate-spin" /></div>
                ) : (
                    <div className="p-6 overflow-y-auto flex-1 space-y-8">

                        {/* 1. General Settings (Meta) */}
                        <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-3">General Information</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Title</label>
                                    <input
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500"
                                    />
                                </div>
                                {entityType === 'space' && (
                                    <div>
                                        <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            rows={2}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm outline-none focus:border-blue-500 resize-none"
                                        />
                                    </div>
                                )}
                                <div className="flex justify-end">
                                    <button
                                        onClick={handleSaveMetadata}
                                        disabled={actionLoading === 'save'}
                                        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                                    >
                                        {actionLoading === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                        Save Info
                                    </button>
                                </div>
                            </div>
                        </div>

                        <hr className="border-slate-100" />

                        {/* 2. Add Member Section */}
                        <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-2">Add People</h3>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search user by email..."
                                    value={searchEmail}
                                    onChange={(e) => setSearchEmail(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-md outline-none focus:border-blue-500 text-sm"
                                />
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                                        {searchResults.map(user => (
                                            <div key={user.id} className="flex items-center justify-between p-2 hover:bg-slate-50 border-b last:border-0 text-sm">
                                                <span className="text-slate-700">{user.email}</span>
                                                <button
                                                    onClick={() => handleUpdateRole(user.id, 'VIEWER')}
                                                    className="text-blue-600 font-medium px-2 py-1 hover:bg-blue-50 rounded"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 3. Members List */}
                        <div>
                            <h3 className="text-sm font-semibold text-slate-700 mb-3">Members with access</h3>
                            <div className="space-y-3">
                                {members.map(member => {
                                    const isSelf = member.userId === currentUserId;
                                    const isInherited = member.source === 'inherited';
                                    // Наследственных участников нельзя редактировать/удалять на уровне документа
                                    const disableControls = isInherited || (isSelf && ownersCount <= 1 && member.role === 'OWNER');

                                    return (
                                        <div key={member.userId} className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center font-bold text-slate-600 text-xs">
                                                    {member.user.email.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium text-slate-800">
                                                        {member.user.email} {isSelf && "(You)"}
                                                    </span>
                                                    {isInherited && (
                                                        <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded mt-0.5 w-fit">
                                                            Inherited from Space
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <select
                                                    value={member.role}
                                                    onChange={(e) => handleUpdateRole(member.userId, e.target.value)}
                                                    disabled={disableControls}
                                                    className="text-sm bg-slate-50 border border-slate-200 rounded p-1 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <option value="OWNER">Owner</option>
                                                    <option value="EDITOR">Editor</option>
                                                    <option value="VIEWER">Viewer</option>
                                                </select>
                                                <button
                                                    onClick={() => handleRemoveMember(member.userId)}
                                                    disabled={disableControls}
                                                    className="p-1.5 text-slate-400 hover:text-red-500 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                                                    title={isInherited ? "Manage in Space Settings" : "Remove access"}
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. Danger Zone */}
                {!loadingData && (
                    <div className={`${isArchived ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'} p-6 border-t flex flex-col gap-4`}>
                        <div className={`flex items-center gap-2 ${isArchived ? 'text-amber-700' : 'text-red-600'}`}>
                            <ShieldAlert className="w-5 h-5" />
                            <span className="text-sm font-medium">Danger Zone</span>
                        </div>

                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className={`text-xs space-y-1 ${isArchived ? 'text-amber-800/80' : 'text-red-800/80'}`}>
                                {!isArchived ? (
                                    <>
                                        <p><strong className="text-red-900">Archive:</strong> Hide from viewers. Can be restored.</p>
                                        <p><strong className="text-red-900">Delete:</strong> Permanent removal. No undo.</p>
                                    </>
                                ) : (
                                    <>
                                        <p><strong className="text-amber-900">Restore:</strong> Make active and visible to all members again.</p>
                                        <p><strong className="text-amber-900">Delete:</strong> Permanent removal. No undo.</p>
                                    </>
                                )}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
                                {isArchived ? (
                                    <button
                                        onClick={handleRestoreEntity}
                                        disabled={!!actionLoading}
                                        className="flex justify-center items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                        {actionLoading === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                        Restore {entityType}
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleArchiveEntity}
                                        disabled={!!actionLoading}
                                        className="flex justify-center items-center gap-2 bg-white border border-red-200 hover:border-red-300 text-red-600 hover:bg-red-50 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                        {actionLoading === 'archive' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                                        Archive
                                    </button>
                                )}

                                <button
                                    onClick={handleDeleteEntity}
                                    disabled={!!actionLoading}
                                    className="flex justify-center items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    {actionLoading === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    Delete Permanently
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}